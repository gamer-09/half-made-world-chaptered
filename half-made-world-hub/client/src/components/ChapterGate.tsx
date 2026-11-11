import { useMemo, useRef, useState } from 'react';
import type { ChapterGateApi } from '../hooks/useChapterGate';
import { parseChapterNumber } from '../hooks/useChapterGate';
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
  const [uploadNumber, setUploadNumber] = useState<string>('');
  const [uploadNote, setUploadNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Every chapter the reader could be on: the known ones plus any uploaded.
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

  const closeUpload = () => {
    onUploadOpenChange(false);
    setUploadText('');
    setUploadNumber('');
    setUploadNote('');
  };

  const submitUpload = () => {
    const n = Number(uploadNumber);
    if (!Number.isFinite(n) || n < 0 || uploadNumber.trim() === '') {
      setUploadNote('Enter a chapter number first.');
      return;
    }
    if (!uploadText.trim()) {
      setUploadNote('Add the chapter text — paste it or choose a file.');
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
              hasn’t reached yet stays locked.
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
    </>
  );
}
