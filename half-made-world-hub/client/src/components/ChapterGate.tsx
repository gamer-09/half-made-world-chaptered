import { useMemo, useRef, useState } from 'react';
import type { ChapterGateApi } from '../hooks/useChapterGate';
import { parseChapterNumber } from '../hooks/useChapterGate';
import { CHAPTERS } from '../chapters/manifest';
import type { GateStats } from '../chapters/gate';
import { Modal } from './Modal';

interface ChapterGateProps {
  gate: ChapterGateApi;
  stats: GateStats | null;
}

function chapterTitle(n: number): string {
  return CHAPTERS.find((c) => c.number === n)?.title ?? `Chapter ${n}`;
}

export function ChapterGate({ gate, stats }: ChapterGateProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploadNumber, setUploadNumber] = useState<string>('');
  const [uploadNote, setUploadNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Every chapter the reader could be on: the bundled ones plus any uploaded.
  const allChapters = useMemo(() => {
    const nums = new Set<number>(CHAPTERS.map((c) => c.number));
    for (const k of Object.keys(gate.uploaded)) nums.add(Number(k));
    return [...nums].sort((a, b) => a - b);
  }, [gate.uploaded]);

  const onPickFile = async (file: File) => {
    const text = await file.text();
    setUploadText(text);
    const n = parseChapterNumber(file.name) ?? parseChapterNumber(text);
    setUploadNumber(n === null ? '' : String(n));
    setUploadNote(
      n === null
        ? 'Could not find a chapter number in that file — set it below.'
        : `Detected chapter ${n} from the file.`,
    );
  };

  const submitUpload = () => {
    const n = Number(uploadNumber);
    if (!Number.isFinite(n) || n < 0 || uploadNumber.trim() === '') {
      setUploadNote('Enter a chapter number first.');
      return;
    }
    gate.upload(n, uploadText);
    setUploadOpen(false);
    setUploadText('');
    setUploadNumber('');
    setUploadNote('');
  };

  const current = gate.off ? 'Author mode' : gate.chapter < 0 ? 'No chapter unlocked' : `Chapter ${gate.chapter}`;

  return (
    <>
      <div className="chapter-gate">
        <div className="chapter-gate-status">
          <span className="chapter-gate-lock" aria-hidden="true">
            <i className={gate.off ? 'fa-solid fa-unlock' : 'fa-solid fa-lock'} />
          </span>
          <span className="chapter-gate-current">{current}</span>
          {!gate.off && gate.chapter >= 0 && (
            <span className="chapter-gate-title">{chapterTitle(gate.chapter)}</span>
          )}
        </div>

        <div className="chapter-gate-chapters">
          {allChapters.map((n) => {
            const unlocked = gate.off || gate.chapter >= n;
            const bundled = CHAPTERS.some((c) => c.number === n);
            return (
              <button
                key={n}
                className={`chapter-chip${unlocked ? ' on' : ''}${!bundled ? ' uploaded' : ''}`}
                onClick={() => gate.unlock(n)}
                title={bundled ? chapterTitle(n) : `Uploaded chapter ${n}`}
                disabled={gate.off}
              >
                {!unlocked && <i className="fa-solid fa-lock" aria-hidden="true" />}
                <span className="chapter-chip-num">Ch {n}</span>
              </button>
            );
          })}
        </div>

        <div className="chapter-gate-actions">
          {stats && !gate.off && (
            <span className="chapter-gate-stats" title="Entries you can see now vs. still hidden">
              {stats.visibleEntries.toLocaleString()} visible · {stats.lockedEntries.toLocaleString()} locked
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setUploadOpen(true)} title="Paste or upload a chapter">
            <i className="fa-solid fa-file-arrow-up" /> Upload
          </button>
          {gate.off ? (
            <button className="btn btn-ghost btn-sm" onClick={gate.enableGate} title="Turn the chapter gate back on">
              <i className="fa-solid fa-lock" /> Re-enable gate
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={gate.revealAll} title="Author view: reveal the whole archive">
              <i className="fa-solid fa-book-open" /> Reveal all
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={gate.reset} title="Lock everything again">
            <i className="fa-solid fa-rotate-left" /> Reset
          </button>
        </div>
      </div>

      {uploadOpen && (
        <Modal onClose={() => setUploadOpen(false)} wide>
          <div className="chapter-upload">
            <h2 className="chapter-upload-title">Upload a chapter</h2>
            <p className="chapter-upload-blurb">
              Unlocking a chapter releases everything that chapter and the ones before it put on the page.
              Details the story hasn’t reached yet stay locked.
            </p>

            <div className="chapter-upload-row">
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                <i className="fa-solid fa-file-lines" /> Choose file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/plain"
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
              value={uploadText}
              onChange={(e) => {
                setUploadText(e.target.value);
                if (uploadNumber.trim() === '') {
                  const n = parseChapterNumber(e.target.value);
                  if (n !== null) setUploadNumber(String(n));
                }
              }}
              rows={8}
            />

            {uploadNote && <p className="chapter-upload-note">{uploadNote}</p>}

            <div className="chapter-upload-actions">
              <button className="btn btn-ghost" onClick={() => setUploadOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitUpload}>
                Unlock chapter
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
