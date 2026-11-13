import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionInfo,
  Entry,
  RecentEntry,
} from './types';
import { Sidebar, type ViewMode } from './components/Sidebar';
import { QueryChatRoom } from './components/QueryChatRoom';
import { BackdropMotion } from './components/BackdropMotion';
import { LofiPlayer } from './components/LofiPlayer';
import { SoundToggle } from './components/SoundToggle';
import { useArchive } from './hooks/useArchive';
import * as liveApi from './api';
import { Dashboard } from './components/Dashboard';
import { EntryCard } from './components/EntryCard';
import { EntryDetail } from './components/EntryDetail';
import { RelationshipMap } from './components/RelationshipMap';
import { StoryWeb } from './components/StoryWeb';
import { BlockMap } from './components/BlockMap';
import { Modal } from './components/Modal';
import { ChapterGate } from './components/ChapterGate';
import { useChapterGate } from './hooks/useChapterGate';
import { setActiveGate } from './chapters/gate';
import { relationshipType } from './relationshipTypes';
import { storyLinkType } from './storyLinkTypes';
import { findCharacter } from './nameMatch';
import { categoryColor } from './theme';

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildMarkdown(entries: Entry[]): string {
  const grouped = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry);
    grouped.set(entry.category, list);
  }
  const lines: string[] = ['# Half-Made World — Worldbuilding Archive', ''];
  for (const [category, list] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${category}`, '');
    for (const entry of list) {
      lines.push(`### ${entry.name}`, '');
      if (entry.subtitle) lines.push(`*${entry.subtitle}*`, '');
      lines.push(entry.description, '');
      for (const field of entry.fields) lines.push(`- **${field.label}:** ${field.value}`);
      if (entry.fields.length) lines.push('');
      if (entry.tags.length) lines.push(`*Tags: ${entry.tags.join(', ')}*`, '');
    }
  }
  return lines.join('\n');
}

export default function App() {
  const gate = useChapterGate();
  const [missingMentions, setMissingMentions] = useState<string[]>([]);
  // Publish the gate before the archive loads so the first fetch is already
  // sliced — otherwise the full archive would flash before the reload.
  setActiveGate(gate.config);
  const archive = useArchive();

  // Scan uploaded chapters for capitalized names that have no archive entry,
  // so the reader can see what still needs to be added.
  useEffect(() => {
    const texts = Object.values(gate.uploaded || {}).join('\n');
    if (!texts.trim()) {
      setMissingMentions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let entries: any[] | null = null;
        // Prefer the live app data when the server is available.
        try {
          const r = await fetch('/api/entries', { cache: 'no-store' });
          if (r.ok) {
            const d = await r.json();
            if (Array.isArray(d) && d.length) entries = d;
          }
        } catch {
          /* fall through to snapshot */
        }
        if (!entries) {
          const res = await fetch(import.meta.env.BASE_URL + 'snapshot.json');
          if (!res.ok) return;
          const data = await res.json();
          entries = data.entries || [];
        }
        const entryNames = (entries || []).map((e: any) =>
          String(e.name || '').toLowerCase().replace(/\s+/g, ' ').trim(),
        );
        const nameSet = new Set(entryNames);
        const stop = new Set([
          'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
          'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
          'he', 'her', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
          'it', 'its', 'just', 'may', 'me', 'might', 'my', 'no', 'not', 'of', 'on',
          'or', 'our', 'ours', 'she', 'so', 'that', 'the', 'their', 'theirs', 'them',
          'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
          'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
          'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'chapter',
          'after', 'before', 'hey', 'just', 'let', 'me', 'be', 'though', 'while',
          'race', 'rank', 'class', 'starting', 'west', 'gates', 'students',
        ]);
        const found = new Set<string>();
        // Only treat words on the SAME line as a single name — never combine
        // across a line break, so "Word\nNext" is not read as "Word Next".
        const re = /\b([A-Z][a-zA-Z]*(?:[ \t]+[A-Z][a-zA-Z]*)+)\b/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(texts)) !== null) {
          const candidate = m[1].trim();
          const words = candidate.toLowerCase().split(/\s+/);
          // Skip common/talking phrases like "As I" or "Through The".
          if (words.every((w) => stop.has(w))) continue;
          if (words.some((w) => stop.has(w) && words.length === 2 && stop.has(words[0]) && stop.has(words[1])))
            continue;
          if (candidate.length < 4) continue;
          const c = candidate.toLowerCase().replace(/\s+/g, ' ').trim();
          // An entry "exists" if its name contains the full candidate phrase,
          // so "Fifth Pillar" matches an entry named "The Fifth Pillar".
          // Bidirectional: present if an entry name is contained in the candidate
          // or vice-versa (so "Malakhim Angel" matches the "Malakhim" entry).
          const exists = entryNames.some(
            (n) => n === c || n.includes(c) || c.includes(n),
          );
          if (exists) continue;
          // Skip noisy all-caps / sentence-fragment candidates.
          const ws = candidate.split(/\s+/);
          if (ws.length > 3) continue;
          if (ws.every((w) => /^[A-Z]+$/.test(w))) continue;
          if (ws.some((w) => stop.has(w.toLowerCase()))) continue;
          found.add(candidate);
        }
        if (!cancelled) setMissingMentions([...found].sort());
      } catch {
        if (!cancelled) setMissingMentions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gate.uploaded]);
  // The reader build is view-only. Editing is a local authoring tool, so it is
  // only possible in a dev build; the chapter gate is orthogonal to it.
  const canEdit = import.meta.env.DEV;
  const entries = archive.entries;
  const relationships = archive.relationships;
  const storyLinks = archive.storyLinks;
  const loading = archive.mode === 'loading';
  const error = archive.error;
  const [view, setView] = useState<ViewMode>('browse');
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Entry | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => {
    try {
      const raw = localStorage.getItem('hmw-recent');
      if (raw) return JSON.parse(raw) as RecentEntry[];
    } catch {
      /* ignore */
    }
    return [];
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  const load = useCallback(async () => {
    await archive.load();
  }, [archive.load]);

  // Reload whenever the unlocked chapter changes — loadSnapshot() re-slices the
  // archive through the active gate on every load.
  useEffect(() => {
    setActiveGate(gate.config);
    load();
  }, [load, gate.config]);

  // Remember the most recent entries the user opened.
  useEffect(() => {
    if (!selected) return;
    setRecent((prev) => {
      const next = [
        { id: selected.id, name: selected.name, category: selected.category, subtitle: selected.subtitle },
        ...prev.filter((r) => r.id !== selected.id),
      ].slice(0, 8);
      try {
        localStorage.setItem('hmw-recent', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [selected]);

  // Saving refetches the archive, but the open detail view still points at the
  // old object. Swap in the fresh copy so edits show the moment they are saved.
  useEffect(() => {
    if (!selected) return;
    const fresh = entries.find((e) => e.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [entries, selected]);

  // Keyboard shortcuts: / focuses search, 1-5 switch views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '1') {
        setView('browse');
      } else if (e.key === '2') {
        setView('map');
      } else if (e.key === '3') {
        setView('web');
      } else if (e.key === '4') {
        setView('blocks');
      } else if (e.key === '5') {
        setView('chat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [entries]);

  const characterEntries = useMemo(
    () => entries.filter((e) => e.category === 'Characters'),
    [entries],
  );

  const allEntryNames = useMemo(() => entries.map((e) => e.name), [entries]);

  const resolveName = useCallback(
    (name: string): string => {
      const exact = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
      if (exact) return exact.name;
      const ch = findCharacter(entries, name);
      if (ch) return ch.name;
      return name;
    },
    [entries],
  );

  const resolveToEntry = useCallback(
    (name: string): Entry | undefined => entries.find((e) => e.name === resolveName(name)),
    [entries, resolveName],
  );

  const connections = useMemo<ConnectionInfo[]>(() => {
    if (!selected) return [];
    const out: ConnectionInfo[] = [];
    for (const s of storyLinks) {
      const src = resolveName(s.source);
      const tgt = resolveName(s.target);
      if (src === selected.name || tgt === selected.name) {
        const t = storyLinkType(s.type);
        out.push({
          kind: 'story',
          typeLabel: s.label || t.label,
          color: t.color,
          otherName: src === selected.name ? tgt : src,
        });
      }
    }
    for (const r of relationships) {
      const src = resolveName(r.source);
      const tgt = resolveName(r.target);
      if (src === selected.name || tgt === selected.name) {
        const t = relationshipType(r.type);
        out.push({
          kind: 'relationship',
          typeLabel: r.label || t.label,
          color: t.color,
          otherName: src === selected.name ? tgt : src,
        });
      }
    }
    return out;
  }, [selected, storyLinks, relationships, resolveName]);

  const filtered = useMemo(() => {
    let list = entries;
    if (activeCategory !== 'All') list = list.filter((e) => e.category === activeCategory);
    if (activeTag) list = list.filter((e) => e.tags.includes(activeTag));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.subtitle && e.subtitle.toLowerCase().includes(q)) ||
          (e.description && e.description.toLowerCase().includes(q)) ||
          e.tags.some((t) => t.toLowerCase().includes(q)) ||
          e.fields.some((f) =>
            (f.label && f.label.toLowerCase().includes(q)) ||
            (f.value && f.value.toLowerCase().includes(q))
          ),
      );
    }
    return list;
  }, [entries, activeCategory, activeTag, search]);

  const selectCategory = (category: string) => {
    setActiveCategory(category);
    setView('browse');
  };

  const selectTag = (tag: string) => {
    setActiveTag(tag);
    setView('browse');
  };

  const clearTag = () => setActiveTag(null);

  const openEntryByName = (name: string) => {
    const entry = resolveToEntry(name);
    if (entry) setSelected(entry);
  };

  // --- Misc ---------------------------------------------------------------
  const handleReset = async () => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    if (
      !window.confirm(
        'Reset the archive to the original seed? This removes all your added entries, relationships, and story links.',
      )
    )
      return;
    try {
      await liveApi.resetWorld();
      setSelected(null);
      setActiveCategory('All');
      setSearch('');
      setView('browse');
      await load();
      showToast('Archive reset to the original seed.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reset failed.');
    }
  };

  const exportMarkdown = () => {
    download('half-made-world.md', buildMarkdown(entries), 'text/markdown');
    showToast(`Exported the full archive (${entries.length} entries) as Markdown.`);
  };

  const exportJson = () => {
    download('half-made-world.json', JSON.stringify(entries, null, 2), 'application/json');
    showToast(`Exported the full archive (${entries.length} entries) as JSON.`);
  };

  const isChatView = view === 'chat';
  const isMapView = view === 'map';
  const isWebView = view === 'web';
  const isBlocksView = view === 'blocks';
  const showDashboard = view === 'browse' && activeCategory === 'All' && search.trim() === '' && !activeTag;

  const viewKey = isChatView
    ? 'chat'
    : isBlocksView
      ? 'blocks'
      : isWebView
        ? 'web'
        : isMapView
          ? 'map'
          : `browse-${activeCategory}`;

  return (
    <div className="app">
      <div className="bg-aurora" aria-hidden="true" />
      <BackdropMotion />
      <Sidebar
        categories={categories}
        total={entries.length}
        activeCategory={activeCategory}
        search={search}
        view={view}
        searchRef={searchRef}
        onSearch={setSearch}
        onSelectCategory={selectCategory}
        onOpenMap={() => setView('map')}
        onOpenWeb={() => setView('web')}
        onOpenBlocks={() => setView('blocks')}
        onOpenChat={() => setView('chat')}
      />

      <main className="main">
        <header className="main-header">
          <div className="main-header-text">
            <h2 className="main-title">
              {isBlocksView
                ? 'Block Chain Map'
                : isWebView
                  ? 'Story Web'
                  : isMapView
                    ? 'Relationship Map'
                    : activeCategory === 'All'
                      ? 'All Entries'
                      : activeCategory}
              {!isMapView && !isWebView && !isBlocksView && (
                <span className="main-count">{filtered.length}</span>
              )}
              {!canEdit && !isMapView && !isWebView && !isBlocksView && (
                <span className="main-mode">chapter-gated</span>
              )}
            </h2>
            <p className="main-sub">
              {isBlocksView
                ? 'The world’s geography as a chain — every place linked to what contains it'
                : isWebView
                  ? 'The whole world at a glance — every realm, monster, artifact, and thread'
                  : isMapView
                    ? 'Who knows whom — and who betrayed whom'
                    : activeCategory === 'All'
                      ? 'Everything in the archive'
                      : `Entries in ${activeCategory}`}
              {!isMapView && !isWebView && !isBlocksView && search.trim() && ` · matching “${search.trim()}”`}
            </p>
          </div>
          <div className="header-actions">
            <SoundToggle />
            <LofiPlayer />
            <button
              className="btn btn-ghost btn-sm"
              onClick={exportMarkdown}
              title="Download the archive as Markdown"
            >
              ⬇ MD
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={exportJson}
              title="Download the archive as JSON"
            >
              ⬇ JSON
            </button>
          </div>
        </header>

        <ChapterGate
          gate={gate}
          stats={archive.gateStats}
          uploadOpen={uploadOpen}
          onUploadOpenChange={setUploadOpen}
        />

        {missingMentions.length > 0 && (
          <div className="missing-entries-corner">
            <h4 className="missing-entries-title">Mentioned, but no entry</h4>
            <ul className="missing-entries-list">
              {missingMentions.map((name) => (
                <li key={name}>
                  {name} <span className="missing-entries-note">— no entry yet</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={`view-transition${isBlocksView ? ' view-fill' : ''}`} key={viewKey}>
        {loading ? (
          <div className="loading">
            <span className="loading-orb" aria-hidden="true" />
            <p>Summoning the archive…</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <p className="empty-title">The archive couldn’t be loaded.</p>
            <p className="empty-text">{error}</p>
            <button className="btn btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        ) : gate.chapter < 0 ? (
          <div className="empty-state">
            <p className="empty-title">The archive is sealed.</p>
            <p className="empty-text">
              Upload a chapter to open it. Its text is read for the entries and names it puts on
              the page — those are revealed, and everything the story hasn’t reached yet stays
              locked.
            </p>
            <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              <i className="fa-solid fa-file-arrow-up" /> Upload a chapter
            </button>
          </div>
        ) : isBlocksView ? (
          <BlockMap entries={entries} storyLinks={storyLinks} onNodeClick={setSelected} />
        ) : isWebView ? (
          <StoryWeb
            entries={entries}
            relationships={relationships}
            storyLinks={storyLinks}
            onNodeClick={setSelected}
          />
        ) : isChatView ? (
          <QueryChatRoom onOpenEntry={openEntryByName} entryNames={allEntryNames} />
        ) : isMapView ? (
          relationships.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No relationships yet.</p>
              <p className="empty-text">The threads will appear once the archive records one.</p>
            </div>
          ) : (
            <RelationshipMap
              relationships={relationships}
              characterEntries={characterEntries}
              onNodeClick={setSelected}
            />
          )
        ) : showDashboard ? (
          <Dashboard
            categories={categories}
            total={entries.length}
            tags={allTags}
            recent={recent}
            onSelectCategory={selectCategory}
            onSelectTag={selectTag}
            onOpenEntry={openEntryByName}
          />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Nothing found.</p>
            <p className="empty-text">Try a different search, or another category.</p>
          </div>
        ) : (
          <>
            {activeTag && (
              <div className="active-filter">
                <span className="filter-chip on">
                  <span className="filter-dot" />
                  #{activeTag}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={clearTag}>
                  ✕ Clear tag
                </button>
              </div>
            )}
            <div className="grid">
              {filtered.map((entry) => (
                <EntryCard key={entry.id} entry={entry} onClick={setSelected} query={search} onSelectTag={selectTag} />
              ))}
            </div>
          </>
        )}
        </div>

        <footer className="main-footer">
          {canEdit && (
            <button className="btn btn-ghost btn-sm" onClick={handleReset} title="Restore the original seed data">
              ↺ Reset to seed
            </button>
          )}
          <span className="footer-note">
            {canEdit
              ? 'Seeded from “Half_made world ideas.docx” · saved to server/data/*.json'
              : 'View-only archive · generated from server/data/*.json at build time'}
          </span>
        </footer>
      </main>

      {selected && (
        <Modal key={selected.id} onClose={() => setSelected(null)} accent={categoryColor(selected.category)}>
          <EntryDetail
            entry={selected}
            connections={connections}
            onOpenEntry={openEntryByName}
          />
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
