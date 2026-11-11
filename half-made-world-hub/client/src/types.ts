export interface Field {
  label: string;
  value: string;
  /** True when the chapter gate is holding this detail back. */
  locked?: boolean;
  /** Chapter that reveals the field (or 9999/undefined for "not yet"). */
  unlocksChapter?: number;
}

export interface Entry {
  id: string;
  category: string;
  name: string;
  subtitle: string;
  description: string;
  fields: Field[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  // --- Chapter-gate annotations (set by the gate, absent when ungated) ---
  /** Chapter this entry first becomes visible in. */
  unlocksChapter?: number;
  lockedSubtitle?: boolean;
  subtitleUnlocksChapter?: number;
  lockedDescription?: boolean;
  descriptionUnlocksChapter?: number;
  /** How many of `fields` are still locked. */
  lockedFieldCount?: number;
}

export interface CategoryInfo {
  name: string;
  count: number;
}

export interface EntryInput {
  category: string;
  name: string;
  subtitle: string;
  description: string;
  fields: Field[];
  tags: string[];
}

export type FormMode = 'add' | 'edit';

export interface RecentEntry {
  id: string;
  name: string;
  category: string;
  subtitle: string;
}

export interface ConnectionInfo {
  kind: 'story' | 'relationship';
  typeLabel: string;
  color: string;
  otherName: string;
}

export interface Relationship {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  description: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipInput {
  source: string;
  target: string;
  type: string;
  label: string;
  description: string;
  color?: string;
}

export interface StoryLink {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  description: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryLinkInput {
  source: string;
  target: string;
  type: string;
  label: string;
  description: string;
  color?: string;
}

export type CanonRule =
  | 'CONTRADICTION'
  | 'BROKEN-REF'
  | 'DUPLICATE'
  | 'DRIFT'
  | 'GAP'
  | 'META'
  | 'ORPHAN'
  | 'SUGGESTED-LINK';

export type CanonSeverity = 'error' | 'warn' | 'info';

export interface CanonFinding {
  rule: CanonRule;
  severity: CanonSeverity;
  name: string;
  id?: string;
  category?: string;
  message: string;
  otherName?: string;
  claim?: string;
  sources?: string[];
  variants?: string[];
  match?: string;
  end?: string;
  /** Verified consistent with locked canon — surfaced but not an error. */
  benign?: boolean;
}

export interface CanonLintResult {
  findings: CanonFinding[];
  scopedTo: string | null;
  total: number;
}
