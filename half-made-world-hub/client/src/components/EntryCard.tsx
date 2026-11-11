import type { CSSProperties, ReactNode } from 'react';
import type { Entry } from '../types';
import { categoryColor } from '../theme';

interface EntryCardProps {
  entry: Entry;
  onClick: (entry: Entry) => void;
  query?: string;
  onSelectTag?: (tag: string) => void;
}

function highlight(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="hl">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return parts;
}

export function EntryCard({ entry, onClick, query = '', onSelectTag }: EntryCardProps) {
  const accent = categoryColor(entry.category);
  return (
    <button
      className="entry-card"
      onClick={() => onClick(entry)}
      style={{ '--accent': accent } as CSSProperties}
    >
      <div className="entry-card-top">
        <span
          className="chip"
          style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
        >
          {entry.category}
        </span>
      </div>
      <h3 className="entry-card-name">{highlight(entry.name, query)}</h3>
      {entry.subtitle && <p className="entry-card-subtitle">{highlight(entry.subtitle, query)}</p>}
      {entry.description ? (
        <p className="entry-card-desc">{highlight(entry.description, query)}</p>
      ) : entry.lockedDescription ? (
        <p className="entry-card-desc entry-card-desc--locked">
          <i className="fa-solid fa-lock" aria-hidden="true" /> Entry sealed
        </p>
      ) : null}
      {(entry.lockedFieldCount ?? 0) > 0 && (
        <p className="entry-card-locked">
          <i className="fa-solid fa-lock" aria-hidden="true" /> {entry.lockedFieldCount} detail
          {entry.lockedFieldCount === 1 ? '' : 's'} locked
        </p>
      )}
      {entry.tags.length > 0 && (
        <div className="entry-card-tags">
          {entry.tags.slice(0, 3).map((tag) =>
            onSelectTag ? (
              <span
                key={tag}
                className="tag tag--clickable"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTag(tag);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    onSelectTag(tag);
                  }
                }}
                title={`Filter by #${tag}`}
              >
                {tag}
              </span>
            ) : (
              <span key={tag} className="tag">
                {tag}
              </span>
            ),
          )}
          {entry.tags.length > 3 && <span className="tag">+{entry.tags.length - 3}</span>}
        </div>
      )}
    </button>
  );
}
