import type { Edge } from 'reactflow';
import type { OsintNode, OsintProject } from '../types/osint';

export const PROJECTS_LIST_ENDPOINT = '/api/projects';
export const PROJECTS_SAVE_ENDPOINT = '/api/projects/save';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  nodeCount: number;
  edgeCount: number;
}

function sanitizeNodesForDisk(nodes: OsintNode[]): OsintNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data: node.data,
    ...(typeof node.width === 'number' ? { width: node.width } : {}),
    ...(typeof node.height === 'number' ? { height: node.height } : {}),
  }));
}

function sanitizeEdgesForDisk(edges: Edge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle } : {}),
    ...(edge.type !== undefined ? { type: edge.type } : {}),
  }));
}

export function buildProjectSavePayload(project: OsintProject): {
  id: string;
  name: string;
  createdAt: string;
  nodes: OsintNode[];
  edges: Edge[];
  nodeCounter: number;
} {
  const cleanNodes = sanitizeNodesForDisk(project.nodes);
  const cleanEdges = sanitizeEdgesForDisk(project.edges);
  const nodeCounter =
    typeof project.nodeCounter === 'number' &&
    Number.isFinite(project.nodeCounter) &&
    project.nodeCounter >= 1
      ? project.nodeCounter
      : Math.max(cleanNodes.length + 1, 1);

  return {
    id: project.id,
    name: project.name.trim() || 'Untitled Project',
    createdAt: project.createdAt || new Date().toISOString(),
    nodes: cleanNodes,
    edges: cleanEdges,
    nodeCounter,
  };
}

/**
 * Fetches the list of saved projects from the local backend `/api/projects`.
 */
export async function fetchProjectList(
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectSummary[]> {
  const res = await fetchImpl(PROJECTS_LIST_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch projects (HTTP ${res.status}).`);
  }

  const json = (await res.json()) as { projects?: unknown };
  const rawList = Array.isArray(json?.projects) ? json.projects : [];

  return rawList
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
    )
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id.trim() : '',
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : 'Untitled Project',
      createdAt:
        typeof item.createdAt === 'string' && item.createdAt.trim()
          ? item.createdAt.trim()
          : new Date().toISOString(),
      updatedAt:
        typeof item.updatedAt === 'string' && item.updatedAt.trim()
          ? item.updatedAt.trim()
          : undefined,
      nodeCount:
        typeof item.nodeCount === 'number' && Number.isFinite(item.nodeCount)
          ? item.nodeCount
          : 0,
      edgeCount:
        typeof item.edgeCount === 'number' && Number.isFinite(item.edgeCount)
          ? item.edgeCount
          : 0,
    }))
    .filter((item) => item.id.length > 0);
}

/**
 * Loads a single full project JSON payload from `/api/projects/:id`.
 */
export async function fetchProjectById(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OsintProject | null> {
  const res = await fetchImpl(
    `${PROJECTS_LIST_ENDPOINT}/${encodeURIComponent(projectId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
  );

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to load project "${projectId}" (HTTP ${res.status}).`);
  }

  const parsed = (await res.json()) as Record<string, unknown>;
  const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as OsintNode[]) : [];
  const edges = Array.isArray(parsed.edges) ? (parsed.edges as Edge[]) : [];
  const nodeCounter =
    typeof parsed.nodeCounter === 'number' &&
    Number.isFinite(parsed.nodeCounter) &&
    parsed.nodeCounter >= 1
      ? parsed.nodeCounter
      : Math.max(nodes.length + 1, 1);

  return {
    id:
      typeof parsed.id === 'string' && parsed.id.trim()
        ? parsed.id.trim()
        : projectId,
    name:
      typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : 'Untitled Project',
    createdAt:
      typeof parsed.createdAt === 'string' && parsed.createdAt.trim()
        ? parsed.createdAt.trim()
        : new Date().toISOString(),
    updatedAt:
      typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim()
        ? parsed.updatedAt.trim()
        : undefined,
    nodes,
    edges,
    nodeCounter,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    isSummaryOnly: false,
  };
}

/**
 * Persists a full project JSON payload to `/api/projects/save` on the local filesystem.
 */
export async function saveProjectToServer(
  project: OsintProject,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectSummary> {
  const body = buildProjectSavePayload(project);
  const res = await fetchImpl(PROJECTS_SAVE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to save project "${project.id}" (HTTP ${res.status}).`);
  }

  const json = (await res.json()) as Partial<ProjectSummary>;
  return {
    id: json.id ?? body.id,
    name: json.name ?? body.name,
    createdAt: json.createdAt ?? body.createdAt,
    updatedAt: json.updatedAt,
    nodeCount:
      typeof json.nodeCount === 'number' ? json.nodeCount : body.nodes.length,
    edgeCount:
      typeof json.edgeCount === 'number' ? json.edgeCount : body.edges.length,
  };
}

/**
 * Deletes a saved project JSON file via `DELETE /api/projects/:id`.
 */
export async function deleteProjectOnServer(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(
    `${PROJECTS_LIST_ENDPOINT}/${encodeURIComponent(projectId)}`,
    {
      method: 'DELETE',
    },
  );

  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(
      `Failed to delete project "${projectId}" (HTTP ${res.status}).`,
    );
  }
  return true;
}
