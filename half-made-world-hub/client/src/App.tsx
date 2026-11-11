import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionInfo,
  Entry,
  EntryInput,
  RecentEntry,
  Relationship,
  RelationshipInput,
  StoryLink,
  StoryLinkInput,
} from './types';
import { Sidebar, type ViewMode } from './components/Sidebar';
import { QueryChatRoom } from './components/QueryChatRoom';
import { PlanningRoom } from './components/PlanningRoom';
import { BackdropMotion } from './components/BackdropMotion';
import { LofiPlayer } from './components/LofiPlayer';
import { SoundToggle } from './components/SoundToggle';
import { useArchive } from './hooks/useArchive';
import * as liveApi from './api';
import { Dashboard } from './components/Dashboard';
import { EntryCard } from './components/EntryCard';
import { EntryDetail } from './components/EntryDetail';
import { EntryForm } from './components/EntryForm';
import { RelationshipMap } from './components/RelationshipMap';
import { StoryWeb } from './components/StoryWeb';
import { BlockMap } from './components/BlockMap';
import { CanonGuard } from './components/CanonGuard';
import { WeaveExplorer } from './components/WeaveExplorer';
import { FlavorFinder } from './components/FlavorFinder';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LinkForm } from './components/LinkForm';
import { Modal } from './components/Modal';
import { ChapterGate } from './components/ChapterGate';
import { useChapterGate } from './hooks/useChapterGate';
import { setActiveGate } from './chapters/gate';
import { RELATIONSHIP_TYPES, relationshipType } from './relationshipTypes';
import { STORY_LINK_TYPES, storyLinkType } from './storyLinkTypes';
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
        const res = await fetch(import.meta.env.BASE_URL + 'snapshot.json');
        if (!res.ok) return;
        const data = await res.json();
        const nameSet = new Set(
          (data.entries || []).map((e: any) => String(e.name || '').toLowerCase()),
        );
        const stop = new Set([
          'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
          'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
          'he', 'her', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
          'it', 'its', 'just', 'may', 'me', 'might', 'my', 'no', 'not', 'of', 'on',
          'or', 'our', 'ours', 'she', 'so', 'that', 'the', 'their', 'theirs', 'them',
          'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
          'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
          'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'chapter',
        ]);
        const found = new Set<string>();
        const re = /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)+)\b/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(texts)) !== null) {
          const candidate = m[1].trim();
          const words = candidate.toLowerCase().split(/\s+/);
          // Skip common/talking phrases like "As I" or "Through The".
          if (words.every((w) => stop.has(w))) continue;
          if (words.some((w) => stop.has(w) && words.length === 2 && stop.has(words[0]) && stop.has(words[1])))
            continue;
          if (candidate.length < 4) continue;
          if (!nameSet.has(candidate.toLowerCase())) found.add(candidate);
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [relFormOpen, setRelFormOpen] = useState(false);
  const [editingRel, setEditingRel] = useState<Relationship | null>(null);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<StoryLink | null>(null);
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

  // Keyboard shortcuts: / focuses search, n adds an entry, 1/2/3/4 switch views.
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
      } else if (e.key === 'n' || e.key === 'N') {
        if (canEdit) openAdd();
        else showToast('This is a view-only build — new entries can’t be added here.');
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
      } else if (e.key === '6' && canEdit) {
        setView('planning');
      } else if (e.key === '7' && canEdit) {
        setView('canon');
      } else if (e.key === '8' && canEdit) {
        setView('weave');
      } else if (e.key === '9' && canEdit) {
        setView('flavor');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

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

  const characterNames = useMemo(() => characterEntries.map((e) => e.name), [characterEntries]);
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

  // --- Entry CRUD ---------------------------------------------------------
  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (entry: Entry) => {
    setEditing(entry);
    setSelected(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const handleSave = async (input: EntryInput) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    try {
      if (editing) {
        await liveApi.updateEntry(editing.id, input);
        showToast(`Updated “${input.name}”.`);
      } else {
        await liveApi.createEntry(input);
        showToast(`Added “${input.name}” to ${input.category}.`);
      }
      closeForm();
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const handleDelete = async (entry: Entry) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    if (!window.confirm(`Delete “${entry.name}” permanently?`)) return;
    try {
      await liveApi.deleteEntry(entry.id);
      setSelected(null);
      showToast(`Deleted “${entry.name}”.`);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const handleDeleteCategory = async (category: string) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    const count = categories.find((c) => c.name === category)?.count ?? 0;
    if (
      !window.confirm(
        `Delete the “${category}” category and all ${count} of its entries?\n\n` +
          `Any relationship or story links pointing at those entries will be removed too. This can’t be undone.`,
      )
    ) {
      return;
    }
    try {
      await liveApi.deleteCategory(category);
      if (activeCategory === category) setActiveCategory('All');
      showToast(`Deleted the “${category}” category and its ${count} entries.`);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  // --- Relationship CRUD --------------------------------------------------
  const openAddRel = () => {
    setEditingRel(null);
    setRelFormOpen(true);
  };

  const openEditRel = (rel: Relationship) => {
    setRelFormOpen(true);
    setEditingRel(rel);
  };

  const closeRelForm = () => {
    setRelFormOpen(false);
    setEditingRel(null);
  };

  const handleSaveRel = async (input: RelationshipInput) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    try {
      if (editingRel) {
        await liveApi.updateRelationship(editingRel.id, input);
        showToast(`Updated the relationship: ${input.source} → ${input.target}.`);
      } else {
        await liveApi.createRelationship(input);
        showToast(`Linked ${input.source} → ${input.target}.`);
      }
      closeRelForm();
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const handleDeleteRel = async (rel: Relationship) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    if (!window.confirm(`Delete the “${rel.label}” link (${rel.source} → ${rel.target})?`)) return;
    try {
      await liveApi.deleteRelationship(rel.id);
      showToast(`Removed the link between ${rel.source} and ${rel.target}.`);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  // --- Story link CRUD ----------------------------------------------------
  const openAddLink = () => {
    setEditingLink(null);
    setLinkFormOpen(true);
  };

  const openEditLink = (link: StoryLink) => {
    setLinkFormOpen(true);
    setEditingLink(link);
  };

  const closeLinkForm = () => {
    setLinkFormOpen(false);
    setEditingLink(null);
  };

  const handleSaveLink = async (input: StoryLinkInput) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    try {
      if (editingLink) {
        await liveApi.updateStoryLink(editingLink.id, input);
        showToast(`Updated the link: ${input.source} → ${input.target}.`);
      } else {
        await liveApi.createStoryLink(input);
        showToast(`Connected ${input.source} → ${input.target}.`);
      }
      closeLinkForm();
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const handleDeleteLink = async (link: StoryLink) => {
    if (!canEdit) {
      showToast('Editing is disabled in the view-only build.');
      return;
    }
    if (!window.confirm(`Delete the “${link.label}” link (${link.source} → ${link.target})?`)) return;
    try {
      await liveApi.deleteStoryLink(link.id);
      showToast(`Removed the link between ${link.source} and ${link.target}.`);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.');
    }
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
  const isPlanningView = view === 'planning' && canEdit;
  const isCanonView = view === 'canon' && canEdit;
  const isWeaveView = view === 'weave' && canEdit;
  const isFlavorView = view === 'flavor' && canEdit;
  const showDashboard = view === 'browse' && activeCategory === 'All' && search.trim() === '' && !activeTag;

  const viewKey = isFlavorView
    ? 'flavor'
    : isWeaveView
    ? 'weave'
    : isCanonView
    ? 'canon'
    : isPlanningView
    ? 'planning'
    : isChatView
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
        onAdd={canEdit ? openAdd : undefined}
        onOpenMap={() => setView('map')}
        onOpenWeb={() => setView('web')}
        onOpenBlocks={() => setView('blocks')}
        onOpenChat={() => setView('chat')}
        onOpenPlanning={canEdit ? () => setView('planning') : undefined}
        onOpenCanon={canEdit ? () => setView('canon') : undefined}
        onOpenWeave={canEdit ? () => setView('weave') : undefined}
        onOpenFlavor={canEdit ? () => setView('flavor') : undefined}
      />

      <main className="main">
        <header className="main-header">
          <div className="main-header-text">
            <h2 className="main-title">
              {isFlavorView
                ? 'Flavor Finder'
                : isWeaveView
                ? 'Weave'
                : isCanonView
                ? 'Canon Guard'
                : isPlanningView
                ? 'Planning'
                : isBlocksView
                  ? 'Block Chain Map'
                  : isWebView
                    ? 'Story Web'
                    : isMapView
                      ? 'Relationship Map'
                      : activeCategory === 'All'
                        ? 'All Entries'
                        : activeCategory}
              {!isMapView && !isWebView && !isBlocksView && !isPlanningView && !isCanonView && !isWeaveView && !isFlavorView && (
                <span className="main-count">{filtered.length}</span>
              )}
              {!canEdit && !isMapView && !isWebView && !isBlocksView && (
                <span className="main-mode">chapter-gated</span>
              )}
            </h2>
            <p className="main-sub">
              {isFlavorView
                ? 'Get one- or two-word flavor descriptors, or rewrite a scene with more life'
                : isWeaveView
                ? 'Timeline, constellation, and the Lore Oracle — a playful way through the archive'
                : isCanonView
                ? 'Report-only consistency check — contradictions, broken links, gaps, drift, and more'
                : isPlanningView
                ? 'Draft new characters, places, and sections with the AI — nothing is saved to the archive'
                : isBlocksView
                  ? 'The world’s geography as a chain — every place linked to what contains it'
                  : isWebView
                    ? 'The whole world at a glance — every realm, monster, artifact, and thread'
                    : isMapView
                      ? 'Who knows whom — and who betrayed whom'
                      : activeCategory === 'All'
                        ? 'Everything in the archive'
                        : `Entries in ${activeCategory}`}
              {!isMapView && !isWebView && !isBlocksView && !isPlanningView && !isCanonView && !isWeaveView && !isFlavorView && search.trim() && ` · matching “${search.trim()}”`}
            </p>
          </div>
          <div className="header-actions">
            <SoundToggle />
            <LofiPlayer />
            {!isMapView && !isWebView && !isBlocksView && !isPlanningView && !isCanonView && activeCategory !== 'All' && canEdit && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDeleteCategory(activeCategory)}
              >
                🗑 Delete “{activeCategory}”
              </button>
            )}
            {isMapView && canEdit && (
              <button className="btn btn-primary btn-sm" onClick={openAddRel}>
                ＋ Add Relationship
              </button>
            )}
            {isWebView && canEdit && (
              <button className="btn btn-primary btn-sm" onClick={openAddLink}>
                ＋ Add Link
              </button>
            )}
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

        <div className={`view-transition${isBlocksView || isPlanningView || isCanonView || isWeaveView || isFlavorView ? ' view-fill' : ''}`} key={viewKey}>
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
        ) : isFlavorView ? (
          <ErrorBoundary label="Flavor Finder">
            <FlavorFinder />
          </ErrorBoundary>
        ) : isWeaveView ? (
          <WeaveExplorer
            entries={entries}
            relationships={relationships}
            storyLinks={storyLinks}
            onOpenEntry={openEntryByName}
          />
        ) : isCanonView ? (
          <CanonGuard onOpenEntry={openEntryByName} />
        ) : isPlanningView ? (
          <PlanningRoom onOpenEntry={openEntryByName} />
        ) : isBlocksView ? (
          <BlockMap entries={entries} storyLinks={storyLinks} onNodeClick={setSelected} />
        ) : isWebView ? (
          <StoryWeb
            entries={entries}
            relationships={relationships}
            storyLinks={storyLinks}
            onNodeClick={setSelected}
            onAdd={canEdit ? openAddLink : undefined}
            onEditStory={canEdit ? openEditLink : undefined}
            onDeleteStory={canEdit ? handleDeleteLink : undefined}
            onEditRel={canEdit ? openEditRel : undefined}
            onDeleteRel={canEdit ? handleDeleteRel : undefined}
          />
        ) : isChatView ? (
          <QueryChatRoom onOpenEntry={openEntryByName} entryNames={allEntryNames} />
        ) : isMapView ? (
          relationships.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No relationships yet.</p>
              <p className="empty-text">Link two characters to start weaving the web.</p>
              {canEdit && (
                <button className="btn btn-primary" onClick={openAddRel}>
                  ＋ Add Relationship
                </button>
              )}
            </div>
          ) : (
            <RelationshipMap
              relationships={relationships}
              characterEntries={characterEntries}
              onNodeClick={setSelected}
              onAdd={canEdit ? openAddRel : undefined}
              onEdit={canEdit ? openEditRel : undefined}
              onDelete={canEdit ? handleDeleteRel : undefined}
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
            onAdd={canEdit ? openAdd : undefined}
          />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Nothing found.</p>
            <p className="empty-text">Try a different search, or add a brand-new entry to the world.</p>
            {canEdit && (
              <button className="btn btn-primary" onClick={openAdd}>
                ＋ Add Entry
              </button>
            )}
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
            onEdit={canEdit ? openEdit : undefined}
            onDelete={canEdit ? handleDelete : undefined}
            onOpenEntry={openEntryByName}
          />
        </Modal>
      )}

      {formOpen && canEdit && (
        <Modal onClose={closeForm} wide>
          <EntryForm
            categories={categories.map((c) => c.name)}
            existingNames={allEntryNames}
            editing={editing}
            onSave={handleSave}
            onCancel={closeForm}
          />
        </Modal>
      )}

      {relFormOpen && canEdit && (
        <Modal onClose={closeRelForm} wide>
          <LinkForm
            title="Relationship"
            names={characterNames}
            types={RELATIONSHIP_TYPES}
            editing={editingRel}
            onSave={handleSaveRel}
            onCancel={closeRelForm}
          />
        </Modal>
      )}

      {linkFormOpen && canEdit && (
        <Modal onClose={closeLinkForm} wide>
          <LinkForm
            title="Story Link"
            names={allEntryNames}
            types={STORY_LINK_TYPES}
            editing={editingLink}
            onSave={handleSaveLink}
            onCancel={closeLinkForm}
          />
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
