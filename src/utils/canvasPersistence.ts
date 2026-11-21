import { del, get, set } from 'idb-keyval';
import type { Edge } from 'reactflow';
import type { OsintNode, OsintProject } from '../types/osint';

export const OSINT_CANVAS_STORAGE_KEY = 'traceboard-osint-canvas-v1';
export const OSINT_PROJECTS_STORAGE_KEY = 'traceboard-osint-projects-v2';
export const OSINT_SYNC_BACKUP_STORAGE_KEY = 'traceboard-osint-sync-backup-v1';
export const CANVAS_SAVE_DEBOUNCE_MS = 150;

export interface PersistedCanvasState {
  version: 1;
  savedAt: string;
  nodeCounter: number;
  nodes: OsintNode[];
  edges: Edge[];
}

export interface PersistedProjectsState {
  version: 2;
  savedAt: string;
  currentProjectId: string | null;
  projects: OsintProject[];
}

function sanitizeNodes(nodes: OsintNode[]): OsintNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data: node.data,
    ...(typeof node.width === 'number' ? { width: node.width } : {}),
    ...(typeof node.height === 'number' ? { height: node.height } : {}),
  }));
}

function sanitizeEdges(edges: Edge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle } : {}),
    ...(edge.type !== undefined ? { type: edge.type } : {}),
  }));
}

/**
 * Normalizes ReactFlow nodes and edges into a clean JSON-serializable snapshot
 * without transient UI interaction flags (selected, dragging).
 */
export function serializeCanvasState(params: {
  nodes: OsintNode[];
  edges: Edge[];
  nodeCounter: number;
  savedAt?: string;
}): PersistedCanvasState {
  const { nodes, edges, nodeCounter, savedAt = new Date().toISOString() } = params;

  return {
    version: 1,
    savedAt,
    nodeCounter: Number.isFinite(nodeCounter) && nodeCounter >= 1 ? nodeCounter : 1,
    nodes: sanitizeNodes(nodes),
    edges: sanitizeEdges(edges),
  };
}

/**
 * Normalizes the entire multi-project array into a clean JSON-serializable snapshot
 * without transient UI interaction flags on any project's nodes or edges.
 */
export function serializeProjectsState(params: {
  projects: OsintProject[];
  currentProjectId: string | null;
  savedAt?: string;
}): PersistedProjectsState {
  const { projects, currentProjectId, savedAt = new Date().toISOString() } = params;

  const cleanProjects: OsintProject[] = projects.map((project) => {
    const cleanNodes = sanitizeNodes(project.nodes);
    const cleanEdges = sanitizeEdges(project.edges);
    return {
      id: project.id,
      name: project.name.trim() || 'Untitled Project',
      createdAt: project.createdAt,
      ...(project.updatedAt ? { updatedAt: project.updatedAt } : {}),
      nodes: cleanNodes,
      edges: cleanEdges,
      nodeCounter:
        typeof project.nodeCounter === 'number' &&
        Number.isFinite(project.nodeCounter) &&
        project.nodeCounter >= 1
          ? project.nodeCounter
          : Math.max(cleanNodes.length + 1, 1),
      nodeCount: project.isSummaryOnly
        ? (project.nodeCount ?? cleanNodes.length)
        : cleanNodes.length,
      edgeCount: project.isSummaryOnly
        ? (project.edgeCount ?? cleanEdges.length)
        : cleanEdges.length,
      ...(project.isSummaryOnly ? { isSummaryOnly: true } : {}),
    };
  });

  const validCurrentId =
    currentProjectId && cleanProjects.some((p) => p.id === currentProjectId)
      ? currentProjectId
      : cleanProjects[0]?.id ?? null;

  return {
    version: 2,
    savedAt,
    currentProjectId: validCurrentId,
    projects: cleanProjects,
  };
}

function isValidNodeArray(nodes: unknown): nodes is OsintNode[] {
  if (!Array.isArray(nodes)) return false;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    if (typeof n.id !== 'string' || !n.position || typeof n.position !== 'object') {
      return false;
    }
    const pos = n.position as Record<string, unknown>;
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
    if (!n.data || typeof n.data !== 'object') return false;
  }
  return true;
}

function isValidEdgeArray(edges: unknown): edges is Edge[] {
  if (!Array.isArray(edges)) return false;
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') return false;
    const e = edge as Record<string, unknown>;
    if (
      typeof e.id !== 'string' ||
      typeof e.source !== 'string' ||
      typeof e.target !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Validates that a value read from IndexedDB matches the PersistedCanvasState schema.
 */
export function isValidPersistedCanvasState(
  value: unknown,
): value is PersistedCanvasState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return false;
  if (typeof record.nodeCounter !== 'number' || !Number.isFinite(record.nodeCounter)) {
    return false;
  }
  if (!isValidNodeArray(record.nodes) || !isValidEdgeArray(record.edges)) {
    return false;
  }
  return true;
}

/**
 * Validates that a value read from IndexedDB matches the multi-project PersistedProjectsState schema.
 */
export function isValidPersistedProjectsState(
  value: unknown,
): value is PersistedProjectsState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 2) return false;
  if (record.currentProjectId !== null && typeof record.currentProjectId !== 'string') {
    return false;
  }
  if (!Array.isArray(record.projects)) return false;

  for (const proj of record.projects) {
    if (!proj || typeof proj !== 'object') return false;
    const p = proj as Record<string, unknown>;
    if (
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.createdAt !== 'string'
    ) {
      return false;
    }
    if (!isValidNodeArray(p.nodes) || !isValidEdgeArray(p.edges)) {
      return false;
    }
  }

  return true;
}

/**
 * Builds a deterministic fingerprint for a connected source image so tool nodes
 * can distinguish restored IndexedDB outputs from new upstream images.
 */
export function buildSourceImageSignature(
  sourceId: string | null,
  imageUrl: string | null,
  extra?: string | number,
): string | null {
  if (!sourceId || !imageUrl) return null;
  const head = imageUrl.slice(0, 48);
  const tail = imageUrl.slice(-24);
  return extra !== undefined
    ? `${sourceId}:${extra}:${imageUrl.length}:${head}:${tail}`
    : `${sourceId}:${imageUrl.length}:${head}:${tail}`;
}

export interface DebouncedController<TArgs extends unknown[]> {
  schedule: (...args: TArgs) => void;
  cancel: () => void;
  flush: () => void;
  hasPending: () => boolean;
}

/**
 * Creates a debounced runner with explicit cancel and flush controls.
 */
export function createDebouncedTask<TArgs extends unknown[]>(
  task: (...args: TArgs) => void | Promise<void>,
  delayMs: number,
): DebouncedController<TArgs> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  const cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastArgs = null;
  };

  const flush = () => {
    if (timerId === null || lastArgs === null) return;
    const argsToRun = lastArgs;
    clearTimeout(timerId);
    timerId = null;
    lastArgs = null;
    void task(...argsToRun);
  };

  const schedule = (...args: TArgs) => {
    lastArgs = args;
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      const argsToRun = lastArgs;
      lastArgs = null;
      if (argsToRun) {
        void task(...argsToRun);
      }
    }, delayMs);
  };

  const hasPending = () => timerId !== null;

  return { schedule, cancel, flush, hasPending };
}

export async function saveCanvasToIdb(state: PersistedCanvasState): Promise<void> {
  await set(OSINT_CANVAS_STORAGE_KEY, state);
}

export async function loadCanvasFromIdb(): Promise<PersistedCanvasState | null> {
  const stored = await get<unknown>(OSINT_CANVAS_STORAGE_KEY);
  if (!isValidPersistedCanvasState(stored)) {
    return null;
  }
  return stored;
}

export async function clearCanvasInIdb(): Promise<void> {
  await del(OSINT_CANVAS_STORAGE_KEY);
}

export async function saveProjectsToIdb(state: PersistedProjectsState): Promise<void> {
  await set(OSINT_PROJECTS_STORAGE_KEY, state);
}

export async function loadProjectsFromIdb(): Promise<PersistedProjectsState | null> {
  const stored = await get<unknown>(OSINT_PROJECTS_STORAGE_KEY);
  if (isValidPersistedProjectsState(stored)) {
    return stored;
  }

  // Fallback migration from legacy single-canvas IndexedDB storage if present
  const legacy = await get<unknown>(OSINT_CANVAS_STORAGE_KEY);
  if (isValidPersistedCanvasState(legacy)) {
    const migratedProject: OsintProject = {
      id: 'proj-migrated-1',
      name: 'Harbor Sector Inquiry',
      createdAt: legacy.savedAt || new Date().toISOString(),
      nodes: legacy.nodes,
      edges: legacy.edges,
      nodeCounter: legacy.nodeCounter,
    };
    return {
      version: 2,
      savedAt: legacy.savedAt || new Date().toISOString(),
      currentProjectId: migratedProject.id,
      projects: [migratedProject],
    };
  }

  return null;
}

export async function clearProjectsInIdb(): Promise<void> {
  await del(OSINT_PROJECTS_STORAGE_KEY);
  await del(OSINT_CANVAS_STORAGE_KEY);
  clearProjectsSyncBackup();
}

const MAX_SYNC_BACKUP_CHARS = 3_500_000;

function getSafeBrowserStorage(): Storage | null {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      globalThis.localStorage
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

/**
 * Synchronously writes a write-ahead snapshot to localStorage so rapid tab switches
 * or page unloads never lose newly added nodes before async IndexedDB / network writes finish.
 */
export function saveProjectsSyncBackup(state: PersistedProjectsState): boolean {
  const storage = getSafeBrowserStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_SYNC_BACKUP_CHARS) {
      return false;
    }
    storage.setItem(OSINT_SYNC_BACKUP_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function loadProjectsSyncBackup(): PersistedProjectsState | null {
  const storage = getSafeBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(OSINT_SYNC_BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidPersistedProjectsState(parsed)) {
      return parsed;
    }
  } catch {
    // Ignore corrupted backup
  }
  return null;
}

export function clearProjectsSyncBackup(): void {
  const storage = getSafeBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(OSINT_SYNC_BACKUP_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

function parseTimestampMs(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Reconciles two copies of the same project (e.g. disk vs IndexedDB vs sync backup),
 * ensuring a summary-only stub never overwrites a full graph and preferring the fresher
 * `updatedAt` (or richer node/edge count when timestamps tie or are missing).
 */
export function pickFresherProject(
  a: OsintProject | null | undefined,
  b: OsintProject | null | undefined,
): OsintProject | null {
  if (!a) return b ?? null;
  if (!b) return a;

  if (a.isSummaryOnly && !b.isSummaryOnly) return b;
  if (b.isSummaryOnly && !a.isSummaryOnly) return a;

  const timeA = parseTimestampMs(a.updatedAt ?? a.createdAt);
  const timeB = parseTimestampMs(b.updatedAt ?? b.createdAt);
  if (timeA > timeB) return a;
  if (timeB > timeA) return b;

  const sizeA = a.nodes.length + a.edges.length;
  const sizeB = b.nodes.length + b.edges.length;
  return sizeB > sizeA ? b : a;
}
