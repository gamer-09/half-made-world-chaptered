import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

// pdfjs and mammoth are loaded lazily. Importing pdfjs at module scope pulls in
// modern globals (Iterator, DOMMatrix) that older Node/jsdom test runners don't
// define, which crashed the whole suite before any test could run.
async function loadBrowserPdfJs(): Promise<any> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  const lib: any = pdfjs;
  const workerUrl = (worker as any).default ?? worker;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  return lib;
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
    const pdfjs = await loadBrowserPdfJs();
    const doc = await pdfjs.getDocument({ data }).promise;
    return await collectPdfText(doc);
  } catch {
    // Fallback for Node/jsdom (and older browsers): legacy build, no worker.
    // Read the file again because pdfjs may detach the first buffer.
    const retryData = new Uint8Array(await file.arrayBuffer());
    const loaded: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjs = loaded.default ?? loaded;
    const doc = await pdfjs.getDocument({ data: retryData }).promise;
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
  const loaded: any = await import('mammoth');
  const mammoth: any = loaded.default ?? loaded;
  // Browser build of mammoth accepts an ArrayBuffer.
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return (result?.value ?? '').toString();
  } catch {
    // Node/jsdom (and mammoth's node build) accept a Buffer.
    const BufferCtor = (globalThis as any).Buffer;
    if (typeof BufferCtor !== 'undefined') {
      const result = await mammoth.extractRawText({ buffer: BufferCtor.from(buffer) });
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
  const [registerError, setRegisterError] = useState('');
  const [registerErrorField, setRegisterErrorField] = useState<'code' | 'chapter' | null>(null);
  const [registerDenied, setRegisterDenied] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerResult, setRegisterResult] = useState<{ code: string; chapter: number } | null>(null);
  // Which registered code is being edited, which one is waiting on a delete
  // confirmation, and which one has a request in flight.
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [redeemShaking, setRedeemShaking] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ chapter: number; title: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Every chapter the reader could be on: the known ones plus any uploaded.
  const allChapters = useMemo(() => {
    const nums = new Set<number>(CHAPTERS.map((c) => c.number));
    for (const k of Object.keys(gate.uploaded)) nums.add(Number(k));
    return [...nums].sort((a, b) => a - b);
  }, [gate.uploaded]);

  // Redeem code mode — standalone, its own page distinct from the upload modal
  const closeRedeem = () => {
    setRedeemOpen(false);
    setRedeemCode('');
    setRedeemError('');
    setRedeemShaking(false);
    setRedeemResult(null);
  };

  // Reject with a shake: state is cleared first so a repeated bad code
  // restarts the animation instead of silently reusing a finished one.
  const failRedeem = (message: string) => {
    setRedeemError(message);
    setRedeemShaking(false);
    const retrigger = () => setRedeemShaking(true);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(retrigger);
    } else {
      window.setTimeout(retrigger, 0);
    }
  };

  const handleRedeemCode = () => {
    const code = redeemCode.trim().toLowerCase();
    if (!code) {
      failRedeem('Enter a code first.');
      return;
    }
    const ch = codes[code];
    if (ch === undefined) {
      failRedeem('That code doesn’t match any chapter.');
      return;
    }
    gate.upload(ch, '');
    setRedeemCode('');
    setRedeemError('');
    setRedeemShaking(false);
    setRedeemResult({ chapter: ch, title: chapterTitle(ch) });
  };

  // Let the seal-break animation finish, then hand the reader back to the
  // freshly unlocked archive instead of leaving them parked in the modal.
  useEffect(() => {
    if (!redeemResult) return;
    const timer = window.setTimeout(() => {
      setRedeemOpen(false);
      setRedeemResult(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [redeemResult]);

  // Registration has its own motion language: a vertical deny/thud on bad
  // input, and a key-forging ceremony on success (never the redeem shake).
  const closeRegister = () => {
    setRegisterOpen(false);
    setRegisterCode('');
    setRegisterChapter('');
    setRegisterError('');
    setRegisterErrorField(null);
    setRegisterDenied(false);
    setRegisterBusy(false);
    setRegisterResult(null);
    setEditingCode(null);
    setPendingDelete(null);
    setListBusy(null);
  };

  const failRegister = (message: string, field: 'code' | 'chapter' | null = null) => {
    setRegisterError(message);
    setRegisterErrorField(field);
    setRegisterDenied(false);
    const retrigger = () => setRegisterDenied(true);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(retrigger);
    } else {
      window.setTimeout(retrigger, 0);
    }
  };

  const resetRegisterForm = () => {
    setRegisterCode('');
    setRegisterChapter('');
    setRegisterError('');
    setRegisterErrorField(null);
    setEditingCode(null);
  };

  const startEditCode = (code: string, chapter: number) => {
    setEditingCode(code);
    setRegisterCode(code);
    setRegisterChapter(String(chapter));
    setRegisterError('');
    setRegisterErrorField(null);
    setPendingDelete(null);
  };

  // The server keeps one code per chapter and one use per code. Mirror that
  // here so the clash shows up before a round trip; the server still enforces
  // it, and its message wins if this list is stale.
  const findRegisterClash = (key: string, chapter: number, ignore: string | null = null) => {
    if (key !== ignore && key in codes) {
      return { field: 'code' as const, message: `Code “${key}” is already registered.` };
    }
    const taken = Object.entries(codes).find(([c, ch]) => ch === chapter && c !== ignore);
    if (taken) {
      return { field: 'chapter' as const, message: `Chapter ${chapter} already has a code (${taken[0]}).` };
    }
    return null;
  };

  // Register a new code, or save the one currently being edited.
  const registerCodeFn = async () => {
    if (registerBusy) return;
    const code = registerCode.trim();
    const ch = Number(registerChapter);
    if (!code) {
      failRegister('Enter a code.', 'code');
      return;
    }
    if (!Number.isFinite(ch) || ch < 0 || registerChapter.trim() === '') {
      failRegister('Enter a chapter number.', 'chapter');
      return;
    }
    const editing = editingCode;
    const clash = findRegisterClash(code.toLowerCase(), ch, editing?.toLowerCase() ?? null);
    if (clash) {
      failRegister(clash.message, clash.field);
      return;
    }
    if (!canRegister) {
      failRegister('Registration is only available when running locally.');
      return;
    }
    setRegisterBusy(true);
    try {
      const res = await fetch(
        editing
          ? `/api/chapter-codes/${encodeURIComponent(editing)}`
          : '/api/chapter-codes',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, chapter: ch }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const field = data?.field === 'code' || data?.field === 'chapter' ? data.field : null;
        failRegister(
          data?.error || (editing ? 'Could not save that code.' : 'Could not register that code.'),
          field,
        );
        return;
      }
      setCodes((prev) => {
        const next = { ...prev };
        if (editing) delete next[editing.toLowerCase()];
        next[code.toLowerCase()] = ch;
        return next;
      });
      if (editing) {
        // Editing is a bookkeeping change, not a reveal — stay in the list so
        // the author can keep tidying codes instead of being thrown out.
        resetRegisterForm();
      } else {
        resetRegisterForm();
        setRegisterResult({ code, chapter: ch });
      }
    } catch {
      failRegister('Could not reach the server to register that code.');
    } finally {
      setRegisterBusy(false);
    }
  };

  const removeCode = async (code: string) => {
    if (listBusy) return;
    setListBusy(code);
    setRegisterError('');
    try {
      const res = await fetch(`/api/chapter-codes/${encodeURIComponent(code)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        failRegister(data?.error || 'Could not delete that code.');
        return;
      }
      setCodes((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      setPendingDelete(null);
      if (editingCode === code) resetRegisterForm();
    } catch {
      failRegister('Could not reach the server to delete that code.');
    } finally {
      setListBusy(null);
    }
  };

  // Hold the forged key on screen just long enough to read, then close.
  useEffect(() => {
    if (!registerResult) return;
    const timer = window.setTimeout(() => {
      setRegisterOpen(false);
      setRegisterResult(null);
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [registerResult]);

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
              Upload a chapter to open the archive. Its text is read for the entries and names it
              puts on the page — those are revealed, and everything the story hasn’t reached yet
              stays locked. The whole chapter is checked against the book text, so a heading or a
              partial paste won’t unlock anything.
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

            <div className="chapter-upload-alt">
              <p className="chapter-upload-alt-text">
                <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                <span>
                  <strong>No chapter file?</strong> You can still get in with a code instead — every
                  chapter ends with one.
                </span>
              </p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  closeUpload();
                  setRedeemOpen(true);
                }}
              >
                <i className="fa-solid fa-magic" aria-hidden="true" /> Redeem a code
              </button>
            </div>
          </div>
        </Modal>
      )}

      {redeemOpen && (
        <Modal onClose={closeRedeem} wide>
          <div className="chapter-upload">
            {redeemResult ? (
              <div className="chapter-unlock" role="status" aria-live="polite">
                <div className="chapter-unlock-stage" aria-hidden="true">
                  <span className="chapter-unlock-halo" />
                  <span className="chapter-unlock-ring chapter-unlock-ring--outer" />
                  <span className="chapter-unlock-ring chapter-unlock-ring--inner" />
                  <span className="chapter-unlock-shock" />
                  <span className="chapter-unlock-seal">
                    <i className="fa-solid fa-lock chapter-unlock-lock" />
                    <i className="fa-solid fa-lock-open chapter-unlock-lock-open" />
                  </span>
                  {Array.from({ length: 12 }, (_, i) => (
                    <span
                      key={i}
                      className="chapter-unlock-spark"
                      style={{ '--spark': i } as CSSProperties}
                    />
                  ))}
                </div>
                <h3 className="chapter-unlock-title">Chapter {redeemResult.chapter} unlocked</h3>
                <p className="chapter-unlock-sub">
                  Unlocked chapter {redeemResult.chapter} · {redeemResult.title}
                </p>
                <div className="chapter-unlock-actions">
                  <button className="btn btn-primary" onClick={closeRedeem}>
                    Continue reading
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="chapter-upload-title">Redeem a chapter code</h2>
                <p className="chapter-upload-blurb">
                  Enter a chapter code to unlock the chapter tier and its manifest-gated entries.
                </p>
                <p className="chapter-redeem-hint">
                  <i className="fa-solid fa-bookmark" aria-hidden="true" />
                  You'll find the code at the end of every chapter.
                </p>
                <div
                  className={`chapter-code-field${redeemError ? ' is-error' : ''}${
                    redeemShaking ? ' shake' : ''
                  }`}
                  onAnimationEnd={() => setRedeemShaking(false)}
                >
                  <label className="chapter-upload-num">
                    Code
                    <input
                      type="text"
                      value={redeemCode}
                      aria-invalid={redeemError ? true : undefined}
                      aria-describedby={redeemError ? 'redeem-error' : undefined}
                      onChange={(e) => {
                        setRedeemCode(e.target.value);
                        if (redeemError) setRedeemError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRedeemCode();
                      }}
                      placeholder="e.g. CH1-AAA"
                    />
                  </label>
                </div>
                {redeemError && (
                  <p className="chapter-redeem-error" id="redeem-error" role="alert">
                    <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {redeemError}
                  </p>
                )}
                <div className="chapter-upload-actions">
                  <button className="btn btn-ghost" onClick={closeRedeem}>
                    Close
                  </button>
                  <button className="btn btn-primary" onClick={handleRedeemCode}>
                    Redeem
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {registerOpen && canRegister && (
        <Modal onClose={closeRegister} wide>
          <div className="chapter-upload">
            {registerResult ? (
              <div className="chapter-forge" role="status" aria-live="polite">
                <div className="chapter-forge-stage" aria-hidden="true">
                  <span className="chapter-forge-ring chapter-forge-ring--outer" />
                  <span className="chapter-forge-ring chapter-forge-ring--inner" />
                  <span className="chapter-forge-glint" />
                  <span className="chapter-forge-stamp" />
                  <span className="chapter-forge-key">
                    <i className="fa-solid fa-key" />
                  </span>
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className="chapter-forge-spark"
                      style={{ '--spark': i } as CSSProperties}
                    />
                  ))}
                </div>
                <h3 className="chapter-forge-title">Code forged</h3>
                <p className="chapter-forge-plate">
                  <code>{registerResult.code}</code>
                  <span className="chapter-forge-arrow" aria-hidden="true">
                    →
                  </span>
                  <span>Chapter {registerResult.chapter}</span>
                </p>
                <p className="chapter-forge-sub">Ready for readers who redeem it.</p>
                <div className="chapter-forge-actions">
                  <button className="btn btn-primary" onClick={closeRegister}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="chapter-upload-title">
                  {editingCode ? 'Edit chapter code' : 'Register a chapter code'}
                </h2>
                <p className="chapter-upload-blurb">
                  {editingCode
                    ? 'Change the code or the chapter it unlocks.'
                    : "Create a code that unlocks a chapter for readers who can't get the chapter text."}
                </p>
                {!editingCode && (
                  <p className="chapter-register-hint">
                    <i className="fa-solid fa-circle-info" aria-hidden="true" />
                    <span>
                      One code per chapter, and a code can only be registered once — duplicates are
                      turned away.
                    </span>
                  </p>
                )}
                <div
                  className={`chapter-register-fields${registerDenied ? ' deny' : ''}`}
                  onAnimationEnd={() => setRegisterDenied(false)}
                >
                  <div
                    className={`chapter-register-field${
                      registerError && registerErrorField === 'code' ? ' is-error' : ''
                    }`}
                  >
                    <label className="chapter-upload-num">
                      Code
                      <input
                        type="text"
                        value={registerCode}
                        aria-invalid={
                          registerError && registerErrorField === 'code' ? true : undefined
                        }
                        aria-describedby={registerError ? 'register-error' : undefined}
                        onChange={(e) => {
                          setRegisterCode(e.target.value);
                          if (registerError) setRegisterError('');
                        }}
                        placeholder="e.g. CH4-SECRET"
                      />
                    </label>
                  </div>
                  <div
                    className={`chapter-register-field${
                      registerError && registerErrorField === 'chapter' ? ' is-error' : ''
                    }`}
                  >
                    <label className="chapter-upload-num">
                      Chapter
                      <input
                        type="number"
                        min={0}
                        value={registerChapter}
                        aria-invalid={
                          registerError && registerErrorField === 'chapter' ? true : undefined
                        }
                        aria-describedby={registerError ? 'register-error' : undefined}
                        onChange={(e) => {
                          setRegisterChapter(e.target.value);
                          if (registerError) setRegisterError('');
                        }}
                        placeholder="e.g. 4"
                      />
                    </label>
                  </div>
                </div>
                {registerError && (
                  <p className="chapter-register-error" id="register-error" role="alert">
                    <i className="fa-solid fa-circle-xmark" aria-hidden="true" /> {registerError}
                  </p>
                )}
                <div className="chapter-upload-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={editingCode ? resetRegisterForm : closeRegister}
                    disabled={registerBusy}
                  >
                    {editingCode ? 'Cancel edit' : 'Close'}
                  </button>
                  <button
                    className={`btn btn-primary${registerBusy ? ' is-forging' : ''}`}
                    onClick={registerCodeFn}
                    disabled={registerBusy}
                  >
                    {registerBusy ? (
                      <>
                        <i className="fa-solid fa-hammer" aria-hidden="true" /> Saving…
                      </>
                    ) : editingCode ? (
                      <>
                        <i className="fa-solid fa-check" aria-hidden="true" /> Save changes
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-hammer" aria-hidden="true" /> Register
                      </>
                    )}
                  </button>
                </div>

                {Object.keys(codes).length > 0 && (
                  <div className="chapter-code-list">
                    <p className="chapter-code-list-head">
                      Registered codes
                      <span className="chapter-code-list-count">{Object.keys(codes).length}</span>
                    </p>
                    <ul className="chapter-code-rows">
                      {Object.entries(codes)
                        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
                        .map(([code, chapter]) => (
                          <li className="chapter-code-row" key={code}>
                            {pendingDelete === code ? (
                              <>
                                <span className="chapter-code-row-prompt">Delete this code?</span>
                                <span className="chapter-code-row-actions">
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    onClick={() => removeCode(code)}
                                    disabled={listBusy === code}
                                  >
                                    {listBusy === code ? 'Deleting…' : 'Delete'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setPendingDelete(null)}
                                    disabled={listBusy === code}
                                  >
                                    Cancel
                                  </button>
                                </span>
                              </>
                            ) : (
                              <>
                                <code className="chapter-code-row-code">{code}</code>
                                <span className="chapter-code-row-arrow" aria-hidden="true">
                                  →
                                </span>
                                <span className="chapter-code-row-chapter">Chapter {chapter}</span>
                                <span className="chapter-code-row-actions">
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    aria-label={`Edit ${code}`}
                                    title="Edit this code"
                                    onClick={() => startEditCode(code, chapter)}
                                  >
                                    <i className="fa-solid fa-pen" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm chapter-code-row-delete"
                                    aria-label={`Delete ${code}`}
                                    title="Delete this code"
                                    onClick={() => setPendingDelete(code)}
                                  >
                                    <i className="fa-solid fa-trash" aria-hidden="true" />
                                  </button>
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
