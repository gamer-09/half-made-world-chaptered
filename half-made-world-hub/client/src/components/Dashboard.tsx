import { useState, type CSSProperties } from 'react';
import type { CategoryInfo, RecentEntry } from '../types';
import { categoryColor } from '../theme';

interface DashboardProps {
  categories: CategoryInfo[];
  total: number;
  tags: { name: string; count: number }[];
  recent: RecentEntry[];
  onSelectCategory: (category: string) => void;
  onSelectTag: (tag: string) => void;
  onOpenEntry: (name: string) => void;
}

const HIGHLIGHTS = ['Artifacts', 'Classes', 'Characters', 'Plot', 'Monsters', 'Realms'];

export function Dashboard({
  categories,
  total,
  tags,
  recent,
  onSelectCategory,
  onSelectTag,
  onOpenEntry,
}: DashboardProps) {
  const [tagQuery, setTagQuery] = useState('');

  const filteredTags = (() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  })();

  return (
    <div className="dashboard">
      <div className="dash-top">
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-eyebrow">The World So Far</p>
            <h2 className="hero-title">
              Welcome to the <span className="grad">Half-Made World</span>
            </h2>
            <p className="hero-text">
              Four realms, angel and demon ranks, divine weapons, and a hundred threads of lore — all of it
              seeded from your reference document. Browse the archive and follow the threads.
            </p>
          </div>
        </section>

        <aside className="dash-rail">
          <section className="panel">
            <h3 className="section-title">At a Glance</h3>
            <div className="stat-list">
              <div className="stat">
                <span className="stat-num">{total}</span>
                <span className="stat-label">Entries</span>
              </div>
              <div className="stat">
                <span className="stat-num">{categories.length}</span>
                <span className="stat-label">Categories</span>
              </div>
              <div className="stat">
                <span className="stat-num">{tags.length}</span>
                <span className="stat-label">Tags</span>
              </div>
            </div>
          </section>

          {recent.length > 0 && (
            <section className="panel">
              <h3 className="section-title">Recently Viewed</h3>
              <div className="recent-list">
                {recent.map((r) => (
                  <button key={r.id} className="recent-item" onClick={() => onOpenEntry(r.name)}>
                    <span className="recent-dot" style={{ background: categoryColor(r.category) }} />
                    <span className="recent-name">{r.name}</span>
                    {r.subtitle && <span className="recent-sub">{r.subtitle}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      <section className="panel">
        <h3 className="section-title">Browse by Category</h3>
        <div className="tile-grid">
          {categories.map((cat) => {
            const color = categoryColor(cat.name);
            const highlight = HIGHLIGHTS.includes(cat.name);
            return (
              <button
                key={cat.name}
                className={`tile${highlight ? ' tile--highlight' : ''}`}
                style={{ '--tile': color } as CSSProperties}
                onClick={() => onSelectCategory(cat.name)}
              >
                <span className="tile-name">{cat.name}</span>
                <span className="tile-count">{cat.count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {tags.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3 className="section-title">Tag Cloud</h3>
            <input
              type="search"
              className="input tag-search"
              placeholder="Search tags…"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
            />
          </div>
          {filteredTags.length === 0 ? (
            <p className="section-hint">No tags match &ldquo;{tagQuery.trim()}&rdquo;.</p>
          ) : (
            <div className="tag-cloud">
              {filteredTags.map((tag) => {
                const max = tags[0].count || 1;
                const size = 0.78 + Math.min(0.42, (tag.count / max) * 0.42);
                return (
                  <button
                    key={tag.name}
                    className="tag-cloud-item"
                    style={{ fontSize: `${size}rem` }}
                    onClick={() => onSelectTag(tag.name)}
                    title={`${tag.count} entr${tag.count === 1 ? 'y' : 'ies'} tagged`}
                  >
                    #{tag.name}
                    <span className="tag-cloud-count">{tag.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
