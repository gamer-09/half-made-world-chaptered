import type { CSSProperties } from 'react';
import type { ConnectionInfo, Entry } from '../types';
import { categoryColor } from '../theme';
import { lockLabel } from '../chapters/manifest';
import { DescriptionRenderer } from './DescriptionRenderer';

interface EntryDetailProps {
  entry: Entry;
  connections: ConnectionInfo[];
  onEdit?: (entry: Entry) => void;
  onDelete?: (entry: Entry) => void;
  onOpenEntry: (name: string) => void;
}

function LockedNote({ chapter, compact }: { chapter?: number; compact?: boolean }) {
  return (
    <span className={`locked-note${compact ? ' locked-note--compact' : ''}`}>
      <i className="fa-solid fa-lock" aria-hidden="true" />
      <span>{lockLabel(chapter)}</span>
    </span>
  );
}

export function EntryDetail({ entry, connections, onEdit, onDelete, onOpenEntry }: EntryDetailProps) {
  const accent = categoryColor(entry.category);
  const lockedFields = entry.fields.filter((f) => f.locked).length;
  return (
    <div className="detail" style={{ '--accent': accent } as CSSProperties}>
      <header className="detail-hero">
        <span
          className="chip"
          style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
        >
          <span className="chip-dot" style={{ background: accent }} />
          {entry.category}
        </span>
        <span className="detail-updated">
          Updated {new Date(entry.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        </span>
      </header>

      <div className="detail-title-block">
        <h2 className="detail-name">{entry.name}</h2>
        {entry.lockedSubtitle ? (
          <p className="detail-subtitle detail-subtitle--locked">
            <i className="fa-solid fa-lock" aria-hidden="true" /> {lockLabel(entry.subtitleUnlocksChapter)}
          </p>
        ) : (
          entry.subtitle && <p className="detail-subtitle">{entry.subtitle}</p>
        )}
      </div>

      {entry.lockedDescription ? (
        <div className="detail-locked-block">
          <i className="fa-solid fa-lock" aria-hidden="true" />
          <div>
            <p className="detail-locked-title">This entry is still sealed.</p>
            <p className="detail-locked-text">
              What the archive knows about {entry.name} isn’t revealed yet — {lockLabel(entry.descriptionUnlocksChapter).toLowerCase()}.
            </p>
          </div>
        </div>
      ) : (
        <DescriptionRenderer text={entry.description} />
      )}

      {entry.fields.length > 0 && (
        <section className="detail-section">
          <h3 className="detail-section-title">
            Details
            {lockedFields > 0 && (
              <span className="detail-locked-count">
                {lockedFields} locked
              </span>
            )}
          </h3>
          <dl className="detail-fields">
            {entry.fields.map((field, i) => (
              <div className={`detail-field${field.locked ? ' detail-field--locked' : ''}`} key={`${field.label}-${i}`}>
                <dt>{field.label}</dt>
                {field.locked ? (
                  <dd>
                    <LockedNote chapter={field.unlocksChapter} compact />
                  </dd>
                ) : (
                  <dd>{field.value}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      )}

      {entry.tags.length > 0 && (
        <section className="detail-section">
          <h3 className="detail-section-title">Tags</h3>
          <div className="detail-tags">
            {entry.tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {connections.length > 0 && (
        <section className="detail-section">
          <h3 className="detail-section-title">
            Connections <span className="conn-count">{connections.length}</span>
          </h3>
          <div className="conn-list">
            {connections.map((c, i) => (
              <div className="conn-row" key={`${c.kind}-${i}`}>
                <span
                  className="chip"
                  style={{ color: c.color, borderColor: `${c.color}55`, background: `${c.color}14` }}
                >
                  {c.typeLabel}
                </span>
                <button className="conn-other" onClick={() => onOpenEntry(c.otherName)}>
                  {c.otherName}
                  <span className="conn-arrow">→</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {onEdit && (
        <div className="detail-actions">
          <button className="btn btn-secondary" onClick={() => onEdit?.(entry)}>
            <i className="fa-solid fa-pen" style={{ fontSize: 11 }} /> Edit
          </button>
          <button className="btn btn-danger" onClick={() => onDelete?.(entry)}>
            <i className="fa-solid fa-trash" style={{ fontSize: 11 }} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
