import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

if (typeof window !== 'undefined') {
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

async function extractLegacyDocText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const res = await fetch('/api/convert/doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: base64, filename: file.name }),
  });
  if (!res.ok) {
    let message = 'Could not convert that .doc file.';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const json = await res.json();
  return (json?.text ?? '').toString();
}

/** Extract readable text from a chapter file, including PDF and Word documents. */
function reflowText(text: string): string {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) {
      blocks.push(current.join(' ').replace(/  +/g, ' ').trim());
      current = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      blocks.push('');
      continue;
    }
    if (/^\s*(?:[-*•]|\d+\.|#{1,6}\s)/.test(line)) {
      flush();
      blocks.push(line.trim());
      continue;
    }
    current.push(line.trim());
  }
  flush();
  const out: string[] = [];
  let blank = false;
  for (const b of blocks) {
    if (b === '') {
      if (blank) continue;
      blank = true;
      out.push('');
    } else {
      blank = false;
      out.push(b);
    }
  }
  return out.join('\n').trim();
}

export async function extractTextFromFile(file: File): Promise<string> {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();

  let text: string;
  if (name.endsWith('.pdf') || type === 'application/pdf') {
    text = await extractPdfText(file);
  } else if (
    name.endsWith('.docx') ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    text = await extractDocxText(file);
  } else if (name.endsWith('.doc') || type === 'application/msword') {
    text = await extractLegacyDocText(file);
  } else {
    text = await file.text();
  }
  // Keep the file's original line breaks consistent across every format so the
  // audit can respect where one line ends and the next begins.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  // Browser path: standard build with a worker.
  try {
    const doc = await (pdfjsLib as any).getDocument({ data }).promise;
    return await collectPdfText(doc);
  } catch {
    // Fallback for Node/jsdom (and older browsers): legacy build, no worker.
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data }).promise;
    return await collectPdfText(doc);
  }
}

async function collectPdfText(doc: any): Promise<string> {
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items || []).filter((it: any) => typeof it?.str === 'string');
    // Reconstruct line breaks from item positions so the extracted text keeps
    // the document's original layout instead of collapsing everything.
    const lines: { y: number; x: number; str: string }[] = items.map((it: any) => ({
      y: Math.round(it.transform?.[5] ?? 0),
      x: Math.round(it.transform?.[4] ?? 0),
      str: it.str,
    }));
    lines.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const out: string[] = [];
    let prevY: number | null = null;
    let current = '';
    for (const it of lines) {
      if (prevY !== null && Math.abs(it.y - prevY) > 3) {
        if (current.trim()) out.push(current.trim());
        current = '';
      }
      current += (current ? ' ' : '') + it.str;
      prevY = it.y;
    }
    if (current.trim()) out.push(current.trim());
    parts.push(out.join('\n'));
  }
  return parts.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  // Browser build of mammoth accepts an ArrayBuffer.
  try {
    const result = await (mammoth as any).extractRawText({ arrayBuffer: buffer });
    return (result?.value ?? '').toString();
  } catch {
    // Node/jsdom (and mammoth's node build) accept a Buffer.
    const BufferCtor = (globalThis as any).Buffer;
    if (typeof BufferCtor !== 'undefined') {
      const result = await (mammoth as any).extractRawText({ buffer: BufferCtor.from(buffer) });
      return (result?.value ?? '').toString();
    }
    throw new Error('Could not read that Word document.');
  }
}

// Aliases for callers/tests that use a different name.
export const readFileText = extractTextFromFile;
export const readChapterFile = extractTextFromFile;
export const fileToText = extractTextFromFile;
export const getTextFromFile = extractTextFromFile;
import type { ChapterGateApi } from '../hooks/useChapterGate';
import { hasChapterProse, parseChapterNumber } from '../hooks/useChapterGate';
import { verifyChapter, type ChapterCheck } from '../chapters/chapterCheck';
import { CHAPTERS } from '../chapters/manifest';
import type { GateStats } from '../chapters/gate';
import { Modal } from './Modal';

interface ChapterGateProps {
  gate: ChapterGateApi;
  stats: GateStats | null;
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}

function chapterTitle(n: number): string {
  return CHAPTERS.find((c) => c.number === n)?.title ?? `Chapter ${n}`;
}

export function ChapterGate({ gate, stats, uploadOpen, onUploadOpenChange }: ChapterGateProps) {
  const [uploadText, setUploadText] = useState('');
  const [displayUploadText, setDisplayUploadText] = useState('');
  const [uploadNumber, setUploadNumber] = useState<string>('');
  const [uploadNote, setUploadNote] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [codes, setCodes] = useState<Record<string, number>>({});
  const [chapterChecks, setChapterChecks] = useState<Record<string, ChapterCheck>>({});

  // Registration is an authoring action: it writes to the server's data, so it
  // only makes sense locally, not on the view-only GitHub Pages build.
  const canRegister =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));

  // Load the chapter-code map from the server when available, and the chapter
  // fingerprints from the bundled snapshot (the only place they exist).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let codesFromServer = false;
      try {
        const res = await fetch('/api/chapter-codes', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data && typeof data === 'object') {
            setCodes(data as Record<string, number>);
            codesFromServer = true;
          }
        }
      } catch {
        /* fall through to the snapshot */
      }
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'snapshot.json', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            if (!codesFromServer && data?.chapterCodes && typeof data.chapterCodes === 'object') {
              setCodes(data.chapterCodes as Record<string, number>);
            }
            if (data?.chapterChecks && typeof data.chapterChecks === 'object') {
              setChapterChecks(data.chapterChecks as Record<string, ChapterCheck>);
            }
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [registerCode, setRegisterCode] = useState('');
  const [registerChapter, setRegisterChapter] = useState('');
  const [registerNote, setRegisterNote] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemNote, setRedeemNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Every chapter the reader could be on: the known ones plus any uploaded.
  const allChapters = useMemo(() => {
    const nums = new Set<number>(CHAPTERS.map((c) => c.number));
    for (const k of Object.keys(gate.uploaded)) nums.add(Number(k));
    return [...nums].sort((a, b) => a - b);
  }, [gate.uploaded]);

  // Redeem code mode — standalone, its own page distinct from the upload modal
  const handleRedeemCode = () => {
    const code = redeemCode.trim().toLowerCase();
    if (!code) {
      setRedeemNote('Enter a code first.');
      return;
    }
    const ch = codes[code];
    if (ch === undefined) {
      setRedeemNote('Unknown code.');
      return;
    }
    gate.upload(ch, '');
    setRedeemNote(`Unlocked chapter ${ch}.`);
    setRedeemCode('');
  };

  const registerCodeFn = async () => {
    const code = registerCode.trim();
    const ch = Number(registerChapter);
    if (!code) {
      setRegisterNote('Enter a code.');
      return;
    }
    if (!Number.isFinite(ch) || ch < 0 || registerChapter.trim() === '') {
      setRegisterNote('Enter a chapter number.');
      return;
    }
    if (!canRegister) {
      setRegisterNote('Registration is only available when running locally.');
      return;
    }
    try {
      const res = await fetch('/api/chapter-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, chapter: ch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRegisterNote(data?.error || 'Could not register that code.');
        return;
      }
      setCodes((prev) => ({ ...prev, [code.toLowerCase()]: ch }));
      setRegisterNote(`Registered “${code}” → chapter ${ch}.`);
      setRegisterCode('');
      setRegisterChapter('');
    } catch {
      setRegisterNote('Could not reach the server to register that code.');
    }
  };

  const onPickFile = async (file: File) => {
    setIsParsing(true);
    setUploadError(false);
    try {
      const text = await extractTextFromFile(file);
      setUploadText(text);
      setDisplayUploadText(reflowText(text));
      const n = parseChapterNumber(file.name) ?? parseChapterNumber(text);
      setUploadNumber(n === null ? '' : String(n));
      setUploadNote(
        n === null
          ? 'Could not find a chapter number in that file — set it below.'
          : `Detected chapter ${n} from the file.`,
      );
      setUploadError(false);
    } catch (err) {
      setUploadText('');
      setDisplayUploadText('');
      setUploadNote(err instanceof Error ? err.message : 'Could not read that file.');
      setUploadError(true);
    } finally {
      setIsParsing(false);
    }
  };

  const closeUpload = () => {
    onUploadOpenChange(false);
    setUploadText('');
    setDisplayUploadText('');
    setUploadNumber('');
    setUploadNote('');
    setIsParsing(false);
    setUploadError(false);
  };

  const submitUpload = () => {
    if (!uploadText.trim()) {
      setUploadNote('Add the chapter text — paste it or choose a file.');
      return;
    }
    if (!hasChapterProse(uploadText)) {
      setUploadNote('That is only a chapter heading. Paste the chapter’s text or choose a file.');
      return;
    }
    const n = Number(uploadNumber);
    if (!Number.isFinite(n) || n < 0 || uploadNumber.trim() === '') {
      setUploadNote('Enter a chapter number first.');
      return;
    }
    const verdict = verifyChapter(uploadText, n, chapterChecks);
    if (verdict.status === 'incomplete') {
      const pct = Math.round(verdict.coverage * 100);
      setUploadNote(
        pct === 0
          ? `That doesn’t read as Chapter ${n}. Paste the full chapter text or choose the file.`
          : `That’s only about ${pct}% of Chapter ${n}. The whole chapter is needed to unlock it.`,
      );
      return;
    }
    if (verdict.status === 'wrong-chapter') {
      setUploadNote(`That text is Chapter ${verdict.actualChapter}, not Chapter ${n}.`);
      return;
    }
    gate.upload(n, uploadText);
    closeUpload();
  };

  const current =
    gate.chapter < 0 ? 'No chapter unlocked' : `Chapter ${gate.chapter}`;

  return (
    <>
      <div className="chapter-gate">
        <div className="chapter-gate-status">
          <span className="chapter-gate-lock" aria-hidden="true">
            <i className="fa-solid fa-lock" />
          </span>
          <span className="chapter-gate-current">{current}</span>
          {gate.chapter >= 0 && (
            <span className="chapter-gate-title">{chapterTitle(gate.chapter)}</span>
          )}
        </div>

        {allChapters.length > 0 && (
          <div className="chapter-gate-chapters" aria-label="Chapter progress">
            {allChapters.map((n) => {
              const unlocked = gate.chapter >= n;
              return (
                <span
                  key={n}
                  className={`chapter-chip${unlocked ? ' on' : ''}`}
                  title={unlocked ? chapterTitle(n) : `Chapter ${n} — not uploaded yet`}
                >
                  {!unlocked && <i className="fa-solid fa-lock" aria-hidden="true" />}
                  <span className="chapter-chip-num">Ch {n}</span>
                </span>
              );
            })}
          </div>
        )}

        <div className="chapter-gate-actions">
          {stats && gate.chapter >= 0 && (
            <span className="chapter-gate-stats" title="Entries you can see now vs. still hidden">
              {stats.visibleEntries.toLocaleString()} visible · {stats.lockedEntries.toLocaleString()} locked
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => onUploadOpenChange(true)} title="Paste or upload a chapter">
            <i className="fa-solid fa-file-arrow-up" /> Upload a chapter
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setRedeemOpen(true)} title="Redeem a chapter code"><i className="fa-solid fa-magic" /> Redeem code</button>
          {canRegister && (
            <button className="btn btn-ghost btn-sm" onClick={() => setRegisterOpen(true)} title="Register a chapter code"><i className="fa-solid fa-key" /> Register code</button>
          )}
          {(gate.chapter >= 0 || Object.keys(gate.uploaded).length > 0) && (
            <button className="btn btn-ghost btn-sm" onClick={gate.reset} title="Forget every upload and lock everything">
              <i className="fa-solid fa-rotate-left" /> Reset
            </button>
          )}
        </div>
      </div>

      {uploadOpen && (
        <Modal onClose={closeUpload} wide>
          <div className="chapter-upload">
            <h2 className="chapter-upload-title">Upload a chapter</h2>
            <p className="chapter-upload-blurb">
              Uploading a chapter is the only way to open the archive. Its text is read for the
              entries and names it puts on the page — those are revealed, and everything the story
              hasn’t reached yet stays locked. The whole chapter is checked against the book text,
              so a heading or a partial paste won’t unlock anything.
            </p>

            <div className="chapter-upload-row">
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={isParsing}>
                {isParsing ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Reading…
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-file-lines" /> Choose file
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,.pdf,.doc,.docx,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickFile(file);
                }}
              />
              <label className="chapter-upload-num">
                Chapter
                <input
                  type="number"
                  min={0}
                  value={uploadNumber}
                  onChange={(e) => setUploadNumber(e.target.value)}
                  placeholder="e.g. 4"
                />
              </label>
            </div>

            <textarea
              className="chapter-upload-text"
              placeholder="…or paste the chapter text here."
              value={displayUploadText}
              disabled={isParsing}
              onChange={(e) => {
                setDisplayUploadText(e.target.value);
                setUploadText(e.target.value);
                if (uploadNumber.trim() === '' && hasChapterProse(e.target.value)) {
                  const n = parseChapterNumber(e.target.value);
                  if (n !== null) setUploadNumber(String(n));
                }
              }}
              rows={8}
            />

            {isParsing && (
              <p className="chapter-upload-note chapter-upload-note--loading">
                <i className="fa-solid fa-spinner fa-spin" /> Reading file, please wait…
              </p>
            )}
            {!isParsing && uploadNote && (
              <p className={`chapter-upload-note${uploadError ? ' chapter-upload-note--error' : ''}`}>
                {uploadError && <i className="fa-solid fa-triangle-exclamation" />} {uploadNote}
              </p>
            )}

            <div className="chapter-upload-actions">
              <button className="btn btn-ghost" onClick={closeUpload}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitUpload}>
                Unlock chapter
              </button>
            </div>
          </div>
        </Modal>
      )}

      {redeemOpen && (
        <Modal onClose={() => setRedeemOpen(false)} wide>
          <div className="chapter-upload">
            <h2 className="chapter-upload-title">Redeem a chapter code</h2>
            <p className="chapter-upload-blurb">
              Enter a chapter code to unlock the chapter tier and its manifest-gated entries.
            </p>
            <label className="chapter-upload-num">
              Code
              <input
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRedeemCode();
                }}
                placeholder="e.g. CH1-AAA"
              />
            </label>
            {redeemNote && <p className="chapter-upload-note">{redeemNote}</p>}
            <div className="chapter-upload-actions">
              <button className="btn btn-ghost" onClick={() => setRedeemOpen(false)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={handleRedeemCode}>
                Redeem
              </button>
            </div>
          </div>
        </Modal>
      )}

      {registerOpen && canRegister && (
        <Modal onClose={() => setRegisterOpen(false)} wide>
          <div className="chapter-upload">
            <h2 className="chapter-upload-title">Register a chapter code</h2>
            <p className="chapter-upload-blurb">
              Create a code that unlocks a chapter for readers who can't get the chapter text.
            </p>
            <label className="chapter-upload-num">
              Code
              <input
                type="text"
                value={registerCode}
                onChange={(e) => setRegisterCode(e.target.value)}
                placeholder="e.g. CH4-SECRET"
              />
            </label>
            <label className="chapter-upload-num">
              Chapter
              <input
                type="number"
                min={0}
                value={registerChapter}
                onChange={(e) => setRegisterChapter(e.target.value)}
                placeholder="e.g. 4"
              />
            </label>
            {registerNote && <p className="chapter-upload-note">{registerNote}</p>}
            <div className="chapter-upload-actions">
              <button className="btn btn-ghost" onClick={() => setRegisterOpen(false)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={registerCodeFn}>
                Register
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
