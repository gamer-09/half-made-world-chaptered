import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, Relationship, StoryLink } from '../types';
import { relationshipType } from '../relationshipTypes';
import { storyLinkType } from '../storyLinkTypes';
import { findCharacter } from '../nameMatch';
import { categoryColor } from '../theme';

// ── Brain-web layout ───────────────────────────────────────────────────
// Nodes are entries (plus any referenced names). A force simulation seeds
// each category as a "lobe" on a ring, then lets repulsion + link springs +
// a gentle pull toward each lobe's home arrange them into an organic web.
// A uniform spatial grid keeps repulsion near O(n) so ~1000 nodes stay fast.
const PICKER_KEY = 'hmw-web-hidden-categories';

// Category ordering used to sort the legend / filter chips. Categories not
// listed here are appended alphabetically after the known ones.
const CATEGORY_ORDER = [
  // Geography
  'Realms', 'Locations', 'Hidden Realm',
  // People & races
  'Characters', 'Humans', 'Angels', 'Demons', 'Beings', 'Monsters', 'Race Types',
  // Story
  'Plot', 'Lore & Myths', 'Calendar', 'Clan',
  // Power systems
  'Magic Systems', 'Rules & Notes', 'Classes', 'Class Skills', 'Class Progression',
  'Grade System', 'Rune Star Circles', 'Innate Abilities', 'Skill Mechanics', 'Concepts',
  // Skills & forms by race
  'Angel Skills', 'Demon Skills', 'Hybrid Skills', 'Ruler Skills', 'Artifact Skills', 'Character Forms',
  // Things
  'Items', 'Artifacts', 'Equipment', 'Coins', 'Resources',
  // Society
  'Organizations', 'Politics', 'Economy', 'Laws & Justice', 'Military', 'Intelligence',
  'Social Classes', 'Titles',
  // Life & world
  'Academy', 'Culture', 'Daily Life', 'Arts & Entertainment', 'Death & Burial',
  'Marriage & Family', 'Languages', 'Nature', 'Religion', 'Travel', 'Architecture',
  'Medical', 'Prisons', 'Combat Mechanics', 'Combat Training',
];

interface Pos { x: number; y: number }
type Positions = Record<string, Pos>;

interface WebEdge {
  id: string; kind: 'story' | 'relationship';
  source: string; target: string; type: string;
  label: string; description: string; color: string; dashed: boolean;
  bend: number;
}

interface Geom {
  ax: number; ay: number; bx: number; by: number;
  mx: number; my: number; curvedPath: string;
}

interface StoryWebProps {
  entries: Entry[]; relationships: Relationship[]; storyLinks: StoryLink[];
  onNodeClick: (entry: Entry) => void;
  onAdd?: () => void;
  onEditStory?: (link: StoryLink) => void;
  onDeleteStory?: (link: StoryLink) => void;
  onEditRel?: (rel: Relationship) => void;
  onDeleteRel?: (rel: Relationship) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Node radius grows with connection count so hubs stand out (brain-like).
function radiusFor(deg: number): number {
  return 5 + Math.min(10, Math.sqrt(deg) * 2.1);
}

// A gentle organic curve between two points. `shorten` pulls the endpoints in
// so arrowheads stay clear of the node circles.
function curvePath(a: Pos, b: Pos, bend: number, shorten: number): Geom {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const sx = a.x + ux * shorten;
  const sy = a.y + uy * shorten;
  const ex = b.x - ux * (shorten + 2);
  const ey = b.y - uy * (shorten + 2);
  const off = bend * dist * 0.12;
  const mx = (sx + ex) / 2 - uy * off;
  const my = (sy + ey) / 2 + ux * off;
  return { ax: sx, ay: sy, bx: ex, by: ey, mx, my, curvedPath: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` };
}

function truncate(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function edgeLabelText(e: WebEdge): string {
  return e.label || (e.kind === 'story' ? storyLinkType(e.type).label : relationshipType(e.type).label);
}

function loadHiddenFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(PICKER_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr);
  } catch { /* ignore */ }
  return new Set();
}

// ── Force-directed "brain web" layout ──────────────────────────────────
function brainLayout(
  displayNodes: { name: string; category: string }[],
  edges: WebEdge[],
  degree: Map<string, number>,
  nonce: number,
): { positions: Positions; size: { width: number; height: number } } {
  const n = displayNodes.length;
  if (n === 0) return { positions: {}, size: { width: 900, height: 640 } };

  const groups = new Map<string, number[]>();
  displayNodes.forEach((nd, i) => {
    const g = groups.get(nd.category);
    if (g) g.push(i); else groups.set(nd.category, [i]);
  });

  const cats = [...groups.keys()].sort();
  const R = Math.max(340, Math.sqrt(n) * 48);
  const pos: Pos[] = new Array(n);
  const home: Pos[] = new Array(n);
  const rot = nonce * 0.37;

  cats.forEach((cat, ci) => {
    const angle = (2 * Math.PI * ci) / cats.length + rot;
    const cx = Math.cos(angle) * R;
    const cy = Math.sin(angle) * R;
    const members = groups.get(cat)!;
    const spread = 24 + Math.sqrt(members.length) * 15;
    members.forEach((idx, j) => {
      const a = (2 * Math.PI * j) / members.length + ci * 0.7 + rot;
      const rr = spread * Math.sqrt((j + 0.5) / members.length);
      pos[idx] = { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
      home[idx] = { x: cx, y: cy };
    });
  });

  const idxByName = new Map(displayNodes.map((nd, i) => [nd.name, i]));
  const links: [number, number][] = [];
  for (const e of edges) {
    const a = idxByName.get(e.source);
    const b = idxByName.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }

  const degArr = displayNodes.map((nd) => degree.get(nd.name) ?? 0);

  const k = 56;
  const cell = k * 1.7;
  const cutoff = cell * 1.45;
  const cutoff2 = cutoff * cutoff;

  const disp: Pos[] = new Array(n);
  const iterations = n > 700 ? 130 : n > 320 ? 200 : 300;

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < n; i += 1) disp[i] = { x: 0, y: 0 };

    // Pairwise repulsion, resolved through a uniform grid.
    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i += 1) {
      const gx = Math.floor(pos[i].x / cell);
      const gy = Math.floor(pos[i].y / cell);
      const key = (gx + 4000) * 100000 + (gy + 4000);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i); else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i += 1) {
      const gx = Math.floor(pos[i].x / cell);
      const gy = Math.floor(pos[i].y / cell);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = grid.get((gx + ox + 4000) * 100000 + (gy + oy + 4000));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let dx = pos[i].x - pos[j].x;
            let dy = pos[i].y - pos[j].y;
            let d2 = dx * dx + dy * dy;
            if (d2 > cutoff2) continue;
            if (d2 < 0.01) {
              const ang = ((hashStr(displayNodes[i].name) + j) % 628) / 100;
              dx = Math.cos(ang); dy = Math.sin(ang); d2 = 1;
            }
            const d = Math.sqrt(d2);
            const f = (k * k) / d2;
            const ux = dx / d;
            const uy = dy / d;
            disp[i].x += ux * f; disp[i].y += uy * f;
            disp[j].x -= ux * f; disp[j].y -= uy * f;
          }
        }
      }
    }

    // Link springs pull connected entries toward a comfortable distance.
    for (const [a, b] of links) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - k) * 0.08;
      const ux = dx / d;
      const uy = dy / d;
      disp[a].x += ux * f; disp[a].y += uy * f;
      disp[b].x -= ux * f; disp[b].y -= uy * f;
    }

    // Keep lobes near home; pull the whole web gently toward the centre.
    for (let i = 0; i < n; i += 1) {
      disp[i].x += (home[i].x - pos[i].x) * 0.018;
      disp[i].y += (home[i].y - pos[i].y) * 0.018;
      const c = 0.0009 * (1 + Math.min(degArr[i], 20) * 0.15);
      disp[i].x -= pos[i].x * c;
      disp[i].y -= pos[i].y * c;
    }

    // Move each node by its accumulated force, capped by a cooling temperature.
    const temp = 9 * (1 - iter / iterations) + 0.4;
    for (let i = 0; i < n; i += 1) {
      const sx = disp[i].x;
      const sy = disp[i].y;
      const len = Math.sqrt(sx * sx + sy * sy);
      if (len > 0.0001) {
        const step = Math.min(len, temp);
        pos[i].x += (sx / len) * step;
        pos[i].y += (sy / len) * step;
      }
    }
  }

  // Normalise into the positive quadrant and measure the bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pos) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 80;
  const positions: Positions = {};
  for (let i = 0; i < n; i += 1) {
    positions[displayNodes[i].name] = { x: pos[i].x - minX + pad, y: pos[i].y - minY + pad };
  }
  return {
    positions,
    size: {
      width: Math.max(900, maxX - minX + pad * 2),
      height: Math.max(640, maxY - minY + pad * 2),
    },
  };
}

// ── Memoized SVG node ─────────────────────────────────────────────────
interface WebNodeProps {
  name: string; category: string; x: number; y: number; r: number;
  opacity: number; active: boolean; focused: boolean; hovered: boolean;
  focusMode: boolean; hasEntry: boolean; showLabel: boolean;
  onPointerEnter: (name: string) => void; onPointerLeave: () => void;
  onPointerDown: (e: React.PointerEvent, name: string) => void;
  onClick: (e: React.MouseEvent, name: string) => void;
  onLabelClick: (e: React.MouseEvent, name: string) => void;
}

const WebNode = memo(function WebNode({
  name, category, x, y, r, opacity, active, focused, hovered, focusMode,
  hasEntry, showLabel, onPointerEnter, onPointerLeave, onPointerDown, onClick, onLabelClick,
}: WebNodeProps) {
  const color = category === 'Other' ? '#7f8fa3' : categoryColor(category);

  return (
    <g
      className={`map-node${active ? ' active' : ''}`}
      opacity={opacity}
      style={{ cursor: focusMode ? 'pointer' : hasEntry ? 'pointer' : 'default' }}
      onPointerEnter={() => onPointerEnter(name)}
      onPointerLeave={onPointerLeave}
      onPointerDown={(e) => onPointerDown(e, name)}
      onClick={(e) => onClick(e, name)}
    >
      {active && <circle cx={x} cy={y} r={r + 5} fill={color} opacity={0.14} />}
      {(hovered || focused) && (
        <circle
          cx={x} cy={y} r={r + 5} fill="none" stroke={color}
          strokeWidth={focused ? 1.6 : 1} opacity={focused ? 0.7 : 0.45}
        />
      )}
      <circle
        cx={x} cy={y} r={r}
        fill={active ? `${color}55` : `${color}22`}
        stroke={color} strokeWidth={active ? 1.6 : 1}
      />
      <text
        x={x} y={y + 4} textAnchor="middle" className="map-node-initial" fill={color}
        style={{ fontSize: Math.max(8, Math.min(11, r)) }}
      >
        {name.charAt(0).toUpperCase()}
      </text>
      {showLabel && (
        <text
          x={x} y={y + r + 13} textAnchor="middle" className="map-node-label"
          style={{ fontSize: 11, cursor: name.length > 18 ? 'help' : 'default' }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onLabelClick(e, name); }}
        >
          {truncate(name)}
        </text>
      )}
    </g>
  );
});

// ── Memoized highlighted edge ─────────────────────────────────────────
interface WebEdgeProps {
  id: string; path: string;
  color: string; dashed: boolean; strokeWidth: number; opacity: number;
  showLabel: boolean; labelX: number; labelY: number; labelText: string; labelWidth: number;
  onPointerEnter: (id: string) => void; onPointerLeave: () => void; onClick: (id: string) => void;
}

const WebEdge = memo(function WebEdge({
  id, path, color, dashed, strokeWidth, opacity,
  showLabel, labelX, labelY, labelText, labelWidth,
  onPointerEnter, onPointerLeave, onClick,
}: WebEdgeProps) {
  return (
    <g
      className="map-edge"
      opacity={opacity}
      onPointerEnter={() => onPointerEnter(id)}
      onPointerLeave={onPointerLeave}
      onClick={(ev) => { ev.stopPropagation(); onClick(id); }}
    >
      <path
        d={path} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={dashed ? '6 5' : undefined}
        markerEnd={`url(#warrow-${color.replace('#', '')})`}
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }} />
      {showLabel && (
        <g pointerEvents="none">
          <rect
            x={labelX - labelWidth / 2} y={labelY - 24} width={labelWidth} height={18} rx={9}
            fill="rgba(7, 11, 22, 0.93)" stroke={color} strokeOpacity={0.6}
          />
          <text
            x={labelX} y={labelY - 11} textAnchor="middle" className="map-edge-label"
            fill={color} style={{ fontSize: 10 }}
          >
            {labelText}
          </text>
        </g>
      )}
    </g>
  );
});

// ── Name popup (positioned absolutely over the SVG) ────────────────────
function NamePopup({ name, x, y, onClose }: { name: string; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: x, top: y - 36,
        background: 'rgba(10, 16, 32, 0.96)',
        border: '1px solid rgba(200, 168, 118, 0.3)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        color: '#e8f1ff',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
        zIndex: 100,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        fontFamily: 'var(--font-head)',
        letterSpacing: '0.3px',
      }}
    >
      {name}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
export function StoryWeb({
  entries, relationships, storyLinks, onNodeClick, onAdd, onEditStory, onDeleteStory, onEditRel, onDeleteRel,
}: StoryWebProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean; startX: number; startY: number } | null>(null);
  const positionsRef = useRef<Positions>({});

  const [positions, setPositions] = useState<Positions>({});
  const [mapSize, setMapSize] = useState({ width: 1400, height: 900 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<WebEdge | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(loadHiddenFromStorage);
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());
  const [initDone, setInitDone] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [focusDepth, setFocusDepth] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ name: string; x: number; y: number } | null>(null);
  const [nonce, setNonce] = useState(0);

  const toSvg = useCallback((clientX: number, clientY: number): Pos => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  const entryByName = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of entries) map.set(e.name.toLowerCase(), e);
    return map;
  }, [entries]);

  const resolve = (name: string): string => {
    const exact = entryByName.get(name.toLowerCase());
    if (exact) return exact.name;
    const ch = findCharacter(entries, name);
    if (ch) return ch.name;
    return name;
  };

  // ---- build normalized nodes + edges ----
  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, string>();
    for (const e of entries) nodeMap.set(e.name, e.category);

    const rawEdges: WebEdge[] = [];
    for (const s of storyLinks) {
      const type = storyLinkType(s.type);
      rawEdges.push({
        id: s.id, kind: 'story',
        source: resolve(s.source), target: resolve(s.target), type: s.type,
        label: s.label, description: s.description,
        color: s.color || type.color, dashed: !!type.dashed,
        bend: (hashStr(`${s.source}|${s.target}`) & 1) === 0 ? 1 : -1,
      });
    }
    for (const r of relationships) {
      const type = relationshipType(r.type);
      rawEdges.push({
        id: r.id, kind: 'relationship',
        source: resolve(r.source), target: resolve(r.target), type: r.type,
        label: r.label, description: r.description,
        color: r.color || type.color, dashed: !!type.dashed,
        bend: (hashStr(`${r.source}|${r.target}`) & 1) === 0 ? 1 : -1,
      });
    }

    for (const edge of rawEdges) {
      if (!nodeMap.has(edge.source)) nodeMap.set(edge.source, 'Other');
      if (!nodeMap.has(edge.target)) nodeMap.set(edge.target, 'Other');
    }

    return {
      nodes: [...nodeMap.entries()].map(([name, category]) => ({ name, category })),
      edges: rawEdges,
    };
  }, [entries, relationships, storyLinks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- filtering ----
  const visibleNodes = useMemo(() =>
    nodes.filter((n) => !hiddenCategories.has(n.category) && !hiddenNodes.has(n.name)),
    [nodes, hiddenCategories, hiddenNodes]);

  const visibleNames = useMemo(() => new Set(visibleNodes.map((n) => n.name)), [visibleNodes]);

  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleNames.has(e.source) && visibleNames.has(e.target)),
    [edges, visibleNames]);

  // ---- focus mode: only a node and its neighbourhood ----
  const focusSet = useMemo(() => {
    const set = new Set<string>();
    if (!focusNode) return set;
    set.add(focusNode);
    let frontier = [focusNode];
    for (let d = 0; d < focusDepth; d += 1) {
      const next: string[] = [];
      for (const name of frontier) {
        for (const e of visibleEdges) {
          if (e.source === name && !set.has(e.target)) { set.add(e.target); next.push(e.target); }
          else if (e.target === name && !set.has(e.source)) { set.add(e.source); next.push(e.source); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return set;
  }, [focusNode, focusDepth, visibleEdges]);

  const displayNodes = useMemo(
    () => (focusMode && focusNode ? visibleNodes.filter((n) => focusSet.has(n.name)) : visibleNodes),
    [focusMode, focusNode, focusSet, visibleNodes]);

  const displayNames = useMemo(() => new Set(displayNodes.map((n) => n.name)), [displayNodes]);

  const displayEdges = useMemo(
    () => edges.filter((e) => displayNames.has(e.source) && displayNames.has(e.target)),
    [edges, displayNames]);

  // ---- degree (connection count): drives node size + hub labels ----
  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  // ---- (re)compute the layout whenever the node set or shuffle changes ----
  useEffect(() => {
    const { positions: next, size } = brainLayout(displayNodes, displayEdges, degree, nonce);
    setPositions(next);
    setMapSize(size);
  }, [displayNodes, displayEdges, degree, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSelectedEdge(null); }, [relationships, storyLinks]);

  useEffect(() => {
    try { localStorage.setItem(PICKER_KEY, JSON.stringify([...hiddenCategories])); } catch { /* */ }
  }, [hiddenCategories]);

  useEffect(() => {
    if (initDone) return;
    setInitDone(true);
    const linked = new Set<string>();
    for (const e of edges) { linked.add(e.source); linked.add(e.target); }
    const isolated = nodes.filter((n) => !linked.has(n.name)).map((n) => n.name);
    if (isolated.length) setHiddenNodes(new Set(isolated));
  }, [edges, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusNode && !nodes.some((n) => n.name === focusNode)) setFocusNode(null);
  }, [nodes, focusNode]);

  useEffect(() => { positionsRef.current = positions; }, [positions]);

  // ---- node dragging ----
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const p = toSvg(e.clientX, e.clientY);
      if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4) drag.moved = true;
      setPositions((prev) => ({
        ...prev,
        [drag.id]: { x: p.x - drag.dx, y: p.y - drag.dy },
      }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [dragging, toSvg]);

  const startDrag = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const p = toSvg(e.clientX, e.clientY);
    const cur = positionsRef.current[id] ?? { x: mapSize.width / 2, y: mapSize.height / 2 };
    dragRef.current = { id, dx: p.x - cur.x, dy: p.y - cur.y, moved: false, startX: p.x, startY: p.y };
    setSelectedEdge(null);
    setDragging(id);
  }, [toSvg, mapSize]);

  // ---- handlers ----
  const handleEdgePointerEnter = useCallback((id: string) => setHoverEdge(id), []);
  const handleEdgePointerLeave = useCallback(() => setHoverEdge(null), []);
  const handleEdgeClick = useCallback((id: string) => {
    setSelectedEdge((cur) => (cur?.id === id ? null : displayEdges.find((e) => e.id === id) ?? cur));
  }, [displayEdges]);

  const handleNodePointerEnter = useCallback((name: string) => setHoverId(name), []);
  const handleNodePointerLeave = useCallback(() => setHoverId(null), []);

  const handleNodeClick = useCallback((e: React.MouseEvent, name: string) => {
    if (dragRef.current?.moved) { dragRef.current = null; return; }
    dragRef.current = null;
    e.stopPropagation();
    if (focusMode) { setFocusNode(name); setSelectedEdge(null); return; }
    const entry = entryByName.get(name.toLowerCase());
    if (entry) onNodeClick(entry);
  }, [focusMode, entryByName, onNodeClick]);

  const handleLabelClick = useCallback((e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    const p = positionsRef.current[name];
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!p || !svg || !container) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const rect = container.getBoundingClientRect();
    const screenX = ctm.a * p.x + ctm.c * p.y + ctm.e;
    const screenY = ctm.b * p.x + ctm.d * p.y + ctm.f;
    setPopup({
      name,
      x: screenX - rect.left + container.scrollLeft,
      y: screenY - rect.top + container.scrollTop,
    });
  }, []);

  // ---- active (highlighted) edges ----
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedEdge) ids.add(selectedEdge.id);
    if (hoverEdge) ids.add(hoverEdge);
    if (hoverId) {
      for (const e of displayEdges) if (e.source === hoverId || e.target === hoverId) ids.add(e.id);
    }
    if (typeFilter) {
      for (const e of displayEdges) if (edgeLabelText(e) === typeFilter) ids.add(e.id);
    }
    return ids;
  }, [selectedEdge, hoverEdge, hoverId, typeFilter, displayEdges]);

  const activeEdges = useMemo(
    () => displayEdges.filter((e) => activeIds.has(e.id)),
    [displayEdges, activeIds]);

  // ---- faint "fibre" layer: every connection, grouped by colour ----
  const fiberPaths = useMemo(() => {
    const byColor = new Map<string, string[]>();
    for (const e of displayEdges) {
      const a = positions[e.source];
      const b = positions[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const off = e.bend * dist * 0.12;
      const mx = (a.x + b.x) / 2 - (dy / dist) * off;
      const my = (a.y + b.y) / 2 + (dx / dist) * off;
      const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
      const list = byColor.get(e.color);
      if (list) list.push(d); else byColor.set(e.color, [d]);
    }
    return [...byColor.entries()];
  }, [displayEdges, positions]);

  const edgeGeom = useMemo(() => {
    const map = new Map<string, Geom>();
    for (const e of activeEdges) {
      const a = positions[e.source];
      const b = positions[e.target];
      if (!a || !b) continue;
      map.set(e.id, curvePath(a, b, e.bend, radiusFor(degree.get(e.source) ?? 0) + 4));
    }
    return map;
  }, [activeEdges, positions, degree]);

  // ---- labels ----
  function boxesIntersect(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  }

  const hubNames = useMemo(() => {
    const max = displayNodes.length > 400 ? 26 : 42;
    const out: string[] = [];
    for (const nd of [...displayNodes].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0))) {
      if ((degree.get(nd.name) ?? 0) <= 0) break;
      out.push(nd.name);
      if (out.length >= max) break;
    }
    return out;
  }, [displayNodes, degree]);

  const nodeLabels = useMemo(() => {
    const shown = new Set<string>();
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const cands = new Set<string>(hubNames);
    if (hoverId) cands.add(hoverId);
    if (focusNode) cands.add(focusNode);
    if (selectedEdge) { cands.add(selectedEdge.source); cands.add(selectedEdge.target); }
    for (const name of cands) {
      const p = positions[name];
      if (!p) continue;
      const r = radiusFor(degree.get(name) ?? 0);
      const w = truncate(name).length * 5.5 + 4;
      const box = { x1: p.x - w / 2, y1: p.y + r + 3, x2: p.x + w / 2, y2: p.y + r + 18 };
      if (!placed.some((q) => boxesIntersect(box, q))) {
        shown.add(name);
        placed.push(box);
      }
    }
    return shown;
  }, [hubNames, positions, hoverId, focusNode, selectedEdge, degree]);

  const edgeLabels = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const e of activeEdges) {
      const g = edgeGeom.get(e.id);
      if (!g) continue;
      const w = edgeLabelText(e).length * 5.5 + 8;
      const box = { x1: g.mx - w / 2, y1: g.my - 24, x2: g.mx + w / 2, y2: g.my - 6 };
      if (placed.some((q) => boxesIntersect(box, q))) continue;
      out.set(e.id, { x: g.mx, y: g.my });
      placed.push(box);
    }
    return out;
  }, [activeEdges, edgeGeom]);

  const markerColors = useMemo(() => {
    const set = new Set<string>();
    for (const e of activeEdges) set.add(e.color);
    return [...set];
  }, [activeEdges]);

  // ---- hover/selection neighbourhood ----
  const neighborNames = useMemo(() => {
    const set = new Set<string>();
    if (!hoverId && !selectedEdge) return set;
    const anchors = new Set<string>();
    if (hoverId) anchors.add(hoverId);
    if (selectedEdge) { anchors.add(selectedEdge.source); anchors.add(selectedEdge.target); }
    for (const e of displayEdges) {
      if (anchors.has(e.source)) set.add(e.target);
      if (anchors.has(e.target)) set.add(e.source);
    }
    return set;
  }, [hoverId, selectedEdge, displayEdges]);

  // ---- type-filter helpers ----
  const filteredNodeSet = useMemo(() => {
    if (!typeFilter) return null;
    const set = new Set<string>();
    for (const e of displayEdges) {
      if (edgeLabelText(e) === typeFilter) { set.add(e.source); set.add(e.target); }
    }
    return set;
  }, [typeFilter, displayEdges]);

  const filteredEdgesCount = useMemo(() => {
    if (!typeFilter) return 0;
    let count = 0;
    for (const e of displayEdges) if (edgeLabelText(e) === typeFilter) count += 1;
    return count;
  }, [typeFilter, displayEdges]);

  const usedTypes = useMemo(() => {
    const seen = new Map<string, { count: number; color: string }>();
    for (const e of displayEdges) {
      const label = edgeLabelText(e);
      const cur = seen.get(label) ?? { count: 0, color: e.color };
      cur.count += 1;
      seen.set(label, cur);
    }
    return [...seen.entries()];
  }, [displayEdges]);

  const presentCategories = useMemo(() => {
    const present = new Set(nodes.map((n) => n.category));
    const known = CATEGORY_ORDER.filter((c) => present.has(c));
    const extra = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...extra];
  }, [nodes]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) map.set(n.category, (map.get(n.category) ?? 0) + 1);
    return map;
  }, [nodes]);

  useEffect(() => {
    const present = new Set(presentCategories);
    if ([...hiddenCategories].every((c) => present.has(c))) return;
    setHiddenCategories((prev) => new Set([...prev].filter((c) => present.has(c))));
  }, [presentCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = (cat: string) => {
    if (hiddenCategories.has(cat)) setHiddenNodes(new Set());
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
    setSelectedEdge(null);
  };
  const showOnly = (cat: string) => { setHiddenCategories(new Set(presentCategories.filter((c) => c !== cat))); setHiddenNodes(new Set()); setSelectedEdge(null); };
  const showAll = () => { setHiddenCategories(new Set()); setHiddenNodes(new Set()); setSelectedEdge(null); };
  const hideAll = () => { setHiddenCategories(new Set(presentCategories)); setHiddenNodes(new Set()); setSelectedEdge(null); };
  const toggleFocusMode = () => { setFocusMode((m) => !m); setFocusNode(null); setSelectedEdge(null); };

  const dim = hoverId !== null || selectedEdge !== null;
  const fiberOpacity = dim ? 0.05 : typeFilter ? 0.06 : 0.14;

  const selectedStory = selectedEdge?.kind === 'story' ? storyLinks.find((s) => s.id === selectedEdge.id) : undefined;
  const selectedRel = selectedEdge?.kind === 'relationship' ? relationships.find((r) => r.id === selectedEdge.id) : undefined;

  return (
    <div className="map-view">
      <div className="map-toolbar">
        <p className="map-hint">
          Brain web — {displayNodes.length} nodes · {displayEdges.length} links · {presentCategories.length - hiddenCategories.size} categories
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setNonce((v) => v + 1)} title="Shuffle the layout">
            ⟳ Re-layout
          </button>
          <button
            className={`btn btn-sm ${focusMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleFocusMode}
            title="Focus mode — click a node to explore only its connections"
          >
            ◎ Focus
          </button>
          {onAdd && (
            <button className="btn btn-primary btn-sm" onClick={onAdd}>
              ＋ Add Link
            </button>
          )}
        </div>
      </div>

      <div className="web-filters">
        <button
          className={`filter-chip${pickerOpen ? ' on' : ''}`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          ☰ Categories
        </button>
        {presentCategories.map((cat) => {
          const visible = !hiddenCategories.has(cat);
          const count = categoryCounts.get(cat) ?? 0;
          return (
            <button
              key={cat}
              className={`filter-chip${visible ? ' on' : ''}`}
              onClick={() => toggleCategory(cat)}
              onDoubleClick={() => showOnly(cat)}
              title="Click to toggle · double-click to show only this category"
            >
              <span className="filter-dot" style={{ background: categoryColor(cat) }} />
              {cat}
              <span className="chip-count">{count}</span>
            </button>
          );
        })}
        {(hiddenCategories.size > 0 || hiddenNodes.size > 0) && (
          <button className="filter-chip reset" onClick={showAll}>Show all</button>
        )}
      </div>

      {pickerOpen && (
        <div className="web-picker">
          <div className="web-picker-head">
            <span className="legend-title">Show categories as nodes</span>
            <div className="web-picker-actions">
              <button className="btn btn-secondary btn-xs" onClick={showAll}>Show all</button>
              <button className="btn btn-secondary btn-xs" onClick={hideAll}>Hide all</button>
            </div>
          </div>
          <div className="web-picker-grid">
            {presentCategories.map((cat) => {
              const visible = !hiddenCategories.has(cat);
              const count = categoryCounts.get(cat) ?? 0;
              return (
                <label key={cat} className={`web-picker-opt${visible ? ' on' : ''}`}>
                  <input type="checkbox" checked={visible} onChange={() => toggleCategory(cat)} />
                  <span className="filter-dot" style={{ background: categoryColor(cat) }} />
                  {cat}
                  <span className="chip-count">{count}</span>
                </label>
              );
            })}
          </div>
          <p className="web-picker-note">
            Your selection is remembered between visits. Double-click a chip to show only that category.
          </p>
        </div>
      )}

      {typeFilter && filteredEdgesCount === 0 && (
        <div className="focus-bar idle">
          <span>No "{typeFilter}" links are visible right now — clear the filter</span>
          <button className="btn btn-secondary btn-xs" onClick={() => setTypeFilter(null)}>✕ Clear filter</button>
        </div>
      )}

      {focusMode && focusNode && (
        <div className="focus-bar">
          <span className="focus-bar-name">◎ Focus: <strong>{focusNode}</strong></span>
          <span className="focus-bar-depth">
            <button className={focusDepth === 1 ? 'on' : ''} onClick={() => setFocusDepth(1)}>1 hop</button>
            <button className={focusDepth === 2 ? 'on' : ''} onClick={() => setFocusDepth(2)}>2 hops</button>
          </span>
          <span className="focus-bar-count">{focusSet.size} nodes · {displayEdges.length} links</span>
          <button className="btn btn-secondary btn-xs" onClick={() => setFocusNode(null)}>✕ Exit focus</button>
        </div>
      )}
      {focusMode && !focusNode && (
        <div className="focus-bar idle">
          <span>◎ Focus mode — <strong>click any node</strong> to explore its connections · Esc to exit</span>
          <button className="btn btn-secondary btn-xs" onClick={toggleFocusMode}>✕ Exit</button>
        </div>
      )}

      <div ref={containerRef} className="map-container web-container" style={{ position: 'relative', overflow: 'auto' }}>
        <svg
          ref={svgRef}
          className="map-svg"
          width={mapSize.width}
          height={mapSize.height}
          viewBox={`0 0 ${mapSize.width} ${mapSize.height}`}
        >
          <defs>
            {markerColors.map((color) => (
              <marker
                key={color}
                id={`warrow-${color.replace('#', '')}`}
                viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill={color} />
              </marker>
            ))}
          </defs>

          {/* Faint fibre layer — every connection, grouped by colour */}
          {fiberPaths.map(([color, ds]) => (
            <path
              key={color}
              d={ds.join(' ')}
              fill="none" stroke={color} strokeWidth={1}
              strokeLinecap="round" opacity={fiberOpacity}
            />
          ))}

          {activeEdges.map((e) => {
            const g = edgeGeom.get(e.id);
            if (!g) return null;
            const lp = edgeLabels.get(e.id);
            const labelText = edgeLabelText(e);
            return (
              <WebEdge
                key={`${e.kind}-${e.id}`}
                id={e.id}
                path={g.curvedPath}
                color={e.color} dashed={e.dashed}
                strokeWidth={2.2} opacity={1}
                showLabel={!!lp} labelX={lp?.x ?? g.mx} labelY={lp?.y ?? g.my}
                labelText={labelText} labelWidth={labelText.length * 5.5 + 14}
                onPointerEnter={handleEdgePointerEnter}
                onPointerLeave={handleEdgePointerLeave}
                onClick={handleEdgeClick}
              />
            );
          })}

          {displayNodes.map((node) => {
            const pos = positions[node.name];
            if (!pos) return null;
            const deg = degree.get(node.name) ?? 0;
            const isHovered = hoverId === node.name;
            const isFocused = focusNode === node.name;
            const isAnchor = !!selectedEdge && (selectedEdge.source === node.name || selectedEdge.target === node.name);
            const active = isHovered || isFocused || isAnchor || neighborNames.has(node.name);
            const filteredOut = typeFilter ? !filteredNodeSet?.has(node.name) : false;
            const opacity = filteredOut ? 0 : (dim && !active ? 0 : 1);
            return (
              <WebNode
                key={node.name}
                name={node.name} category={node.category}
                x={pos.x} y={pos.y} r={radiusFor(deg)}
                opacity={opacity} active={active} focused={isFocused}
                hovered={isHovered} focusMode={focusMode}
                hasEntry={!!entryByName.get(node.name.toLowerCase())}
                showLabel={nodeLabels.has(node.name)}
                onPointerEnter={handleNodePointerEnter}
                onPointerLeave={handleNodePointerLeave}
                onPointerDown={startDrag}
                onClick={handleNodeClick}
                onLabelClick={handleLabelClick}
              />
            );
          })}
        </svg>

        {popup && (
          <NamePopup name={popup.name} x={popup.x} y={popup.y} onClose={() => setPopup(null)} />
        )}

        {selectedEdge && (
          <div className="map-edge-detail">
            <div className="map-edge-detail-head">
              <span className="chip" style={{ color: selectedEdge.color, borderColor: `${selectedEdge.color}55`, background: `${selectedEdge.color}14` }}>
                {edgeLabelText(selectedEdge)}
              </span>
              <button className="modal-close" onClick={() => setSelectedEdge(null)} aria-label="Close" style={{ position: 'static' }}>✕</button>
            </div>
            <p className="map-edge-relation">
              <strong>{selectedEdge.source}</strong> → <strong>{selectedEdge.target}</strong>
            </p>
            {selectedEdge.description && <p className="map-edge-desc">{selectedEdge.description}</p>}
            {onEditStory && onDeleteStory && selectedStory && (
              <div className="map-edge-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => onEditStory?.(selectedStory)}>
                  <i className="fa-solid fa-pen" style={{ fontSize: 11 }} /> Edit
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => onDeleteStory?.(selectedStory)}>
                  <i className="fa-solid fa-trash" style={{ fontSize: 11 }} /> Delete
                </button>
              </div>
            )}
            {onEditRel && onDeleteRel && selectedRel && (
              <div className="map-edge-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => onEditRel?.(selectedRel)}>
                  <i className="fa-solid fa-pen" style={{ fontSize: 11 }} /> Edit
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => onDeleteRel?.(selectedRel)}>
                  <i className="fa-solid fa-trash" style={{ fontSize: 11 }} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="map-legend">
        <span className="legend-title">Legend</span>
        {usedTypes.map(([label, info]) => (
          <button
            key={label}
            className={`legend-item legend-filter-btn${typeFilter === label ? ' active' : ''}`}
            onClick={() => setTypeFilter((cur) => (cur === label ? null : label))}
            title={typeFilter === label ? 'Clear this link-type filter' : `Show only "${label}" connections`}
          >
            <span className="legend-dot" style={{ background: info.color }} />
            {label}
            <span className="legend-count">{info.count}</span>
          </button>
        ))}
        {typeFilter && (
          <button className="legend-item legend-filter-btn reset" onClick={() => setTypeFilter(null)}>✕ Clear</button>
        )}
      </div>

      <div className="map-legend web-category-legend">
        <span className="legend-title">Node colors</span>
        {presentCategories.map((cat) => (
          <span key={cat} className="legend-item" style={{ opacity: hiddenCategories.has(cat) ? 0.35 : 1 }}>
            <span className="legend-dot" style={{ background: categoryColor(cat) }} />
            {cat}
            <span className="legend-count">{categoryCounts.get(cat) ?? 0}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
