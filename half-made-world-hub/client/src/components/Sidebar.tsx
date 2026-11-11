import type { Ref } from 'react';
import type { CategoryInfo } from '../types';
import { categoryColor } from '../theme';

export type ViewMode = 'browse' | 'map' | 'web' | 'blocks' | 'chat';

interface SidebarProps {
  categories: CategoryInfo[];
  total: number;
  activeCategory: string;
  search: string;
  view: ViewMode;
  searchRef?: Ref<HTMLInputElement>;
  onSearch: (q: string) => void;
  onSelectCategory: (category: string) => void;
  onAdd?: () => void;
  onOpenMap: () => void;
  onOpenWeb: () => void;
  onOpenBlocks: () => void;
  onOpenChat: () => void;
}

export function Sidebar({
  categories,
  total,
  activeCategory,
  search,
  view,
  searchRef,
  onSearch,
  onSelectCategory,
  onAdd,
  onOpenMap,
  onOpenWeb,
  onOpenBlocks,
  onOpenChat,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="34" height="34">
            <circle cx="32" cy="32" r="16" fill="none" stroke="url(#brandGrad)" strokeWidth="2.5" />
            <circle cx="32" cy="32" r="6" fill="url(#brandGrad)" />
            <path d="M32 8 L35 26 L50 26 L37 36 L42 56 L32 42 L22 56 L27 36 L14 26 L29 26 Z" fill="none" stroke="#c8a876" strokeWidth="1.5" opacity="0.6" />
            <defs>
              <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#c8a876" />
                <stop offset="1" stopColor="#8f6b3c" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div>
          <h1 className="brand-name">Half-Made</h1>
          <p className="brand-sub">Worldbuilding Archive</p>
        </div>
      </div>

      {onAdd && (
        <button
          className="btn btn-primary btn-block"
          onClick={onAdd}
        >
          <span className="btn-icon">+</span> Add Entry
        </button>
      )}

      <p className="sidebar-group-label">Explore</p>

      <button
        className={`nav-map-btn${view === 'map' ? ' active' : ''}`}
        onClick={onOpenMap}
        title="Who knows whom — and who betrayed whom"
      >
        <i className="fa-solid fa-diagram-project" style={{ fontSize: 14, color: view === 'map' ? '#c8a876' : 'currentColor' }} />
        Relationship Map
      </button>

      <button
        className={`nav-map-btn${view === 'web' ? ' active' : ''}`}
        onClick={onOpenWeb}
        title="The whole world at a glance — realms, monsters, artifacts, plot"
      >
        <i className="fa-solid fa-globe" style={{ fontSize: 14, color: view === 'web' ? '#c8a876' : 'currentColor' }} />
        Story Web
      </button>

      <button
        className={`nav-map-btn${view === 'blocks' ? ' active' : ''}`}
        onClick={onOpenBlocks}
        title="The world's geography as a chain of linked blocks"
      >
        <i className="fa-solid fa-cubes" style={{ fontSize: 14, color: view === 'blocks' ? '#c8a876' : 'currentColor' }} />
        Block Chain Map
      </button>

      <button
        className={`nav-map-btn${view === 'chat' ? ' active' : ''}`}
        onClick={onOpenChat}
        title="Ask questions about the archive"
      >
        <i className="fa-solid fa-message" style={{ fontSize: 14, color: view === 'chat' ? '#c8a876' : 'currentColor' }} />
        Query Chat
      </button>

      <label className="search-wrap">
        <span className="search-icon" aria-hidden="true">
          <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 13 }} />
        </span>
        <input
          type="search"
          name="search"
          ref={searchRef}
          className="search-input"
          placeholder="Search the world… ( / )"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>

      <p className="sidebar-group-label">Categories</p>

      <nav className="category-nav">
        <button
          className={`category-item${activeCategory === 'All' && view === 'browse' ? ' active' : ''}`}
          onClick={() => onSelectCategory('All')}
        >
          <span className="category-dot" style={{ background: '#7f8fa3' }} />
          <span className="category-name">All Entries</span>
          <span className="category-count">{total}</span>
        </button>

        {categories.map((cat) => (
          <button
            key={cat.name}
            className={`category-item${activeCategory === cat.name && view === 'browse' ? ' active' : ''}`}
            onClick={() => onSelectCategory(cat.name)}
          >
            <span className="category-dot" style={{ background: categoryColor(cat.name) }} />
            <span className="category-name">{cat.name}</span>
            <span className="category-count">{cat.count}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
