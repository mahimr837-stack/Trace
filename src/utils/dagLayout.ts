import dagre from '@dagrejs/dagre';
import type { Edge } from 'reactflow';
import type { OsintNode } from '../types/osint';
import { HANDLE_IDS } from './osintGraph';

export type DagLayoutDirection = 'LR' | 'TB';

export interface DagLayoutOptions {
  direction?: DagLayoutDirection;
  rankSep?: number;
  nodeSep?: number;
  marginX?: number;
  marginY?: number;
}

export interface NodeDimensions {
  width: number;
  height: number;
}

const DEFAULT_DIMENSIONS_BY_TYPE: Record<string, NodeDimensions> = {
  imageNode: { width: 288, height: 280 },
  cropNode: { width: 240, height: 240 },
  chatNode: { width: 420, height: 420 },
  resultNode: { width: 352, height: 390 },
  ocrNode: { width: 320, height: 290 },
  exifNode: { width: 320, height: 290 },
  enhanceNode: { width: 320, height: 320 },
  mapNode: { width: 352, height: 340 },
  reverseSearchNode: { width: 320, height: 280 },
  faceNode: { width: 352, height: 340 },
  videoNode: { width: 384, height: 420 },
  dorkNode: { width: 352, height: 340 },
  forensicsNode: { width: 384, height: 380 },
  geoSpyNode: { width: 352, height: 360 },
  geoIntelNode: { width: 352, height: 360 },
  pivotNode: { width: 320, height: 300 },
  dopplerNode: { width: 384, height: 420 },
  suspectNode: { width: 420, height: 460 },
};

const FALLBACK_NODE_DIMENSIONS: NodeDimensions = {
  width: 340,
  height: 320,
};

/**
 * Resolves layout bounding-box dimensions for a canvas node, preferring measured
 * React Flow dimensions when available and falling back to per-node-type defaults.
 */
export function getNodeLayoutDimensions(
  node: Pick<OsintNode, 'type'> & { width?: number | null; height?: number | null },
): NodeDimensions {
  const typeDefaults =
    (node.type && DEFAULT_DIMENSIONS_BY_TYPE[node.type]) ||
    FALLBACK_NODE_DIMENSIONS;

  const width =
    typeof node.width === 'number' && Number.isFinite(node.width) && node.width > 0
      ? Math.max(node.width, typeDefaults.width)
      : typeDefaults.width;

  const height =
    typeof node.height === 'number' && Number.isFinite(node.height) && node.height > 0
      ? Math.max(node.height, typeDefaults.height)
      : typeDefaults.height;

  return { width, height };
}

function isVerticalImageGroupEdge(edge: Edge): boolean {
  return (
    edge.sourceHandle === HANDLE_IDS.IMAGE_GROUP_OUT ||
    edge.targetHandle === HANDLE_IDS.IMAGE_GROUP_IN
  );
}

/**
 * Collects connected components of vertical ImageNode group chains so grouped
 * ImageNodes share horizontal rank placement while staying vertically stacked.
 */
function buildImageGroupComponents(
  nodeIds: Set<string>,
  edges: Edge[],
): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!isVerticalImageGroupEdge(edge)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;

    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const visited = new Set<string>();
  const memberToGroup = new Map<string, string[]>();

  for (const startId of adjacency.keys()) {
    if (visited.has(startId)) continue;
    const component: string[] = [];
    const queue: string[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const next of adjacency.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    for (const memberId of component) {
      memberToGroup.set(memberId, component);
    }
  }

  return memberToGroup;
}

/**
 * Organizes canvas nodes cleanly using a Dagre DAG hierarchy based on their
 * directed edge connections. Preserves all node data and properties while
 * updating node positions to non-overlapping hierarchical coordinates.
 */
export function computeDagLayout(
  nodes: OsintNode[],
  edges: Edge[],
  options: DagLayoutOptions = {},
): OsintNode[] {
  if (nodes.length === 0) return [];

  const direction: DagLayoutDirection = options.direction ?? 'LR';
  const rankSep = options.rankSep ?? 96;
  const nodeSep = options.nodeSep ?? 48;
  const marginX = options.marginX ?? 40;
  const marginY = options.marginY ?? 96;

  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: direction,
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: marginX,
    marginy: marginY,
    ranker: 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set<string>();
  const dimensionsById = new Map<string, NodeDimensions>();

  for (const node of nodes) {
    nodeIds.add(node.id);
    const dims = getNodeLayoutDimensions(node);
    dimensionsById.set(node.id, dims);
    g.setNode(node.id, {
      width: dims.width,
      height: dims.height,
    });
  }

  const imageGroups = buildImageGroupComponents(nodeIds, edges);

  // Add horizontal DAG flow edges and propagate downstream targets across vertical ImageNode groups
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.source === edge.target) continue;

    if (isVerticalImageGroupEdge(edge)) {
      // Vertical group wires stack images within the same rank column rather than pushing target right
      continue;
    }

    g.setEdge(edge.source, edge.target, { weight: 2, minlen: 1 });

    const groupMembers = imageGroups.get(edge.source);
    if (groupMembers) {
      for (const memberId of groupMembers) {
        if (memberId !== edge.source && memberId !== edge.target) {
          g.setEdge(memberId, edge.target, { weight: 1, minlen: 1 });
        }
      }
    }
  }

  dagre.layout(g);

  const rawPositions = new Map<string, { x: number; y: number }>();

  for (const node of nodes) {
    const dagreNode = g.node(node.id) as { x: number; y: number } | undefined;
    const dims = dimensionsById.get(node.id) ?? FALLBACK_NODE_DIMENSIONS;

    const topLeftX = dagreNode
      ? dagreNode.x - dims.width / 2
      : node.position.x;
    const topLeftY = dagreNode
      ? dagreNode.y - dims.height / 2
      : node.position.y;

    rawPositions.set(node.id, { x: topLeftX, y: topLeftY });
  }

  // Ensure vertical ImageNode group chains (Bottom handle -> Top handle) are stacked top-to-bottom in chain order
  const processedGroups = new Set<string[]>();
  for (const group of imageGroups.values()) {
    if (processedGroups.has(group) || group.length < 2) continue;
    processedGroups.add(group);

    const groupSet = new Set(group);
    const inDegree = new Map<string, number>();
    const nextInChain = new Map<string, string[]>();
    for (const id of group) {
      inDegree.set(id, 0);
      nextInChain.set(id, []);
    }

    for (const edge of edges) {
      if (
        isVerticalImageGroupEdge(edge) &&
        groupSet.has(edge.source) &&
        groupSet.has(edge.target)
      ) {
        nextInChain.get(edge.source)!.push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      }
    }

    const orderedMembers: string[] = [];
    const queue = group.filter((id) => (inDegree.get(id) ?? 0) === 0);
    const seen = new Set<string>(queue);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      orderedMembers.push(curr);
      for (const nxt of nextInChain.get(curr) ?? []) {
        inDegree.set(nxt, (inDegree.get(nxt) ?? 1) - 1);
        if ((inDegree.get(nxt) ?? 0) <= 0 && !seen.has(nxt)) {
          seen.add(nxt);
          queue.push(nxt);
        }
      }
    }
    for (const id of group) {
      if (!seen.has(id)) orderedMembers.push(id);
    }

    const sortedYs = group
      .map((id) => rawPositions.get(id)?.y ?? 0)
      .sort((a, b) => a - b);

    for (let i = 0; i < orderedMembers.length; i++) {
      const memberId = orderedMembers[i];
      const existing = rawPositions.get(memberId);
      if (existing && sortedYs[i] !== undefined) {
        rawPositions.set(memberId, { x: existing.x, y: sortedYs[i] });
      }
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const pos of rawPositions.values()) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
  }

  const offsetX = Number.isFinite(minX) ? marginX - minX : 0;
  const offsetY = Number.isFinite(minY) ? marginY - minY : 0;

  return nodes.map((node) => {
    const pos = rawPositions.get(node.id) ?? node.position;
    return {
      ...node,
      position: {
        x: Math.round(pos.x + offsetX),
        y: Math.round(pos.y + offsetY),
      },
    };
  });
}
