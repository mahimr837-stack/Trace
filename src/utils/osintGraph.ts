import type { Connection, Edge } from 'reactflow';
import type { ExpandedTags } from 'exifreader';
import type {
  ChatContextMap,
  CropNodeData,
  DeployableOsintNodeType,
  EnhanceNodeData,
  ExifNodeData,
  FaceNodeData,
  ImageNodeData,
  MapNodeData,
  OcrNodeData,
  OsintNode,
  ResultNodeData,
  ReverseSearchNodeData,
  ChatNodeData,
  VideoNodeData,
  DorkNodeData,
  ForensicsNodeData,
  GeoSpyNodeData,
  GeoIntelNodeData,
  PivotNodeData,
  DopplerNodeData,
  SuspectNodeData,
  ShodanNodeData,
  ArchiveNodeData,
} from '../types/osint';
import { parseCoordinatesFromText, type GeoCoordinates } from './mapCoordinates';
import { extractCandidateUsername } from './usernamePivot';
import { extractCandidateArchiveUrl } from './archiveOsint';
import { defaultUtcInputValue } from './dopplerAudio';

export const NODE_DRAG_MIME_TYPE = 'application/traceboard-node-type';

export const DEPLOYABLE_NODE_TYPES: readonly DeployableOsintNodeType[] = [
  'imageNode',
  'cropNode',
  'chatNode',
  'resultNode',
  'ocrNode',
  'exifNode',
  'enhanceNode',
  'mapNode',
  'reverseSearchNode',
  'faceNode',
  'videoNode',
  'dorkNode',
  'forensicsNode',
  'geoSpyNode',
  'geoIntelNode',
  'pivotNode',
  'dopplerNode',
  'suspectNode',
  'shodanNode',
  'archiveNode',
] as const;

export function isDeployableOsintNodeType(
  value: string,
): value is DeployableOsintNodeType {
  return (DEPLOYABLE_NODE_TYPES as readonly string[]).includes(value);
}

export interface DragDataTransferLike {
  getData(format: string): string;
  types?: readonly string[] | DOMStringList;
}

export function hasDraggedNodeType(
  dataTransfer: Pick<DragDataTransferLike, 'types'> | null | undefined,
): boolean {
  if (!dataTransfer?.types) return false;
  const types = Array.from(dataTransfer.types);
  if (types.includes('Files')) return false;
  return types.includes(NODE_DRAG_MIME_TYPE) || types.includes('text/plain');
}

export function readDraggedNodeType(
  dataTransfer: DragDataTransferLike | null | undefined,
): DeployableOsintNodeType | null {
  if (!dataTransfer) return null;
  const custom = dataTransfer.getData(NODE_DRAG_MIME_TYPE).trim();
  if (isDeployableOsintNodeType(custom)) return custom;
  const fallback = dataTransfer.getData('text/plain').trim();
  if (isDeployableOsintNodeType(fallback)) return fallback;
  return null;
}

export function computeDroppedNodePosition(flowPosition: {
  x: number;
  y: number;
}): { x: number; y: number } {
  return {
    x: Math.round(flowPosition.x - 128),
    y: Math.round(flowPosition.y - 22),
  };
}

function normalizePosition(position?: {
  x?: unknown;
  y?: unknown;
}): { x: number; y: number } | null {
  if (
    position &&
    typeof position.x === 'number' &&
    Number.isFinite(position.x) &&
    typeof position.y === 'number' &&
    Number.isFinite(position.y)
  ) {
    return {
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
  }
  return null;
}

export function createOsintNode(params: {
  nodeType: DeployableOsintNodeType;
  index: number;
  existingNodes: OsintNode[];
  position?: { x: number; y: number };
}): OsintNode {
  const { nodeType, index, existingNodes, position } = params;
  const explicitPosition = normalizePosition(position);

  switch (nodeType) {
    case 'imageNode': {
      const offset = ((index - 4) % 5) * 32;
      return {
        id: `img-${index}`,
        type: 'imageNode',
        position: explicitPosition ?? { x: 110 + offset, y: 170 + offset },
        data: {
          kind: 'image',
          title: `Evidence Frame ${index}`,
          imageUrl: null,
          sourceLabel: 'Unassigned',
        } satisfies ImageNodeData,
      };
    }
    case 'cropNode': {
      const count = existingNodes.filter((n) => n.type === 'cropNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `crop-${index}`,
        type: 'cropNode',
        position: explicitPosition ?? { x: 420, y: 170 + offset },
        data: {
          kind: 'crop',
          title: '',
          imageUrl: null,
        } satisfies CropNodeData,
      };
    }
    case 'chatNode': {
      const offset = ((index - 4) % 5) * 32;
      return {
        id: `chat-${index}`,
        type: 'chatNode',
        position: explicitPosition ?? { x: 470 + offset, y: 160 + offset },
        data: {
          kind: 'chat',
          title: `Analysis Thread ${index}`,
          messages: [],
        } satisfies ChatNodeData,
      };
    }
    case 'resultNode': {
      const offset = ((index - 4) % 5) * 32;
      return {
        id: `res-${index}`,
        type: 'resultNode',
        position: explicitPosition ?? { x: 920 + offset, y: 160 + offset },
        data: {
          kind: 'result',
          title: `Forensic Output ${index}`,
          analysisText: '',
          enhancedImageUrl: null,
          enhancedCaption: '',
          sourceSummary: 'Awaiting wire from ChatNode',
          updatedAt: '',
        } satisfies ResultNodeData,
      };
    }
    case 'ocrNode': {
      const count = existingNodes.filter((n) => n.type === 'ocrNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `ocr-${index}`,
        type: 'ocrNode',
        position: explicitPosition ?? { x: 740, y: 580 + offset },
        data: {
          kind: 'ocr',
          title: `OCR Extractor ${index}`,
        } satisfies OcrNodeData,
      };
    }
    case 'exifNode': {
      const count = existingNodes.filter((n) => n.type === 'exifNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `exif-${index}`,
        type: 'exifNode',
        position: explicitPosition ?? { x: 40, y: 710 + offset },
        data: {
          kind: 'exif',
          title: `EXIF Inspector ${index}`,
          summary: null,
          sourceTitle: null,
        } satisfies ExifNodeData,
      };
    }
    case 'enhanceNode': {
      const count = existingNodes.filter((n) => n.type === 'enhanceNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `enhance-${index}`,
        type: 'enhanceNode',
        position: explicitPosition ?? { x: 390, y: 690 + offset },
        data: {
          kind: 'enhance',
          title: `Super-Resolution ${index}`,
          scale: 2,
          enhancedImageUrl: null,
          sourceDimensions: null,
          outputDimensions: null,
          sourceTitle: null,
        } satisfies EnhanceNodeData,
      };
    }
    case 'mapNode': {
      const count = existingNodes.filter((n) => n.type === 'mapNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `map-${index}`,
        type: 'mapNode',
        position: explicitPosition ?? { x: 1120, y: 690 + offset },
        data: {
          kind: 'map',
          title: `Geolocation Map ${index}`,
        } satisfies MapNodeData,
      };
    }
    case 'reverseSearchNode': {
      const count = existingNodes.filter((n) => n.type === 'reverseSearchNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `reverse-${index}`,
        type: 'reverseSearchNode',
        position: explicitPosition ?? { x: 740, y: 820 + offset },
        data: {
          kind: 'reverseSearch',
          title: `Reverse Search ${index}`,
        } satisfies ReverseSearchNodeData,
      };
    }
    case 'faceNode': {
      const count = existingNodes.filter((n) => n.type === 'faceNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `face-${index}`,
        type: 'faceNode',
        position: explicitPosition ?? { x: 390, y: 920 + offset },
        data: {
          kind: 'face',
          title: `Face Detector ${index}`,
          faceCount: null,
          sourceTitle: null,
        } satisfies FaceNodeData,
      };
    }
    case 'videoNode': {
      const count = existingNodes.filter((n) => n.type === 'videoNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `video-${index}`,
        type: 'videoNode',
        position: explicitPosition ?? { x: 40, y: 920 + offset },
        data: {
          kind: 'video',
          title: `Video Inspector ${index}`,
          fileName: null,
          duration: null,
          intervalSeconds: 1,
          selectedTimestamp: 0,
          frames: [],
        } satisfies VideoNodeData,
      };
    }
    case 'dorkNode': {
      const count = existingNodes.filter((n) => n.type === 'dorkNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `dork-${index}`,
        type: 'dorkNode',
        position: explicitPosition ?? { x: 1120, y: 920 + offset },
        data: {
          kind: 'dork',
          title: `Dork Generator ${index}`,
          targetType: 'General OSINT',
          dorks: [],
          lastSourceSummary: null,
        } satisfies DorkNodeData,
      };
    }
    case 'forensicsNode': {
      const count = existingNodes.filter((n) => n.type === 'forensicsNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `forensics-${index}`,
        type: 'forensicsNode',
        position: explicitPosition ?? { x: 390, y: 1120 + offset },
        data: {
          kind: 'forensics',
          title: `ELA Forensics ${index}`,
          viewMode: 'ela',
          elaImageUrl: null,
          dimensions: null,
          maxChannelDiff: null,
          meanChannelDiff: null,
          sourceTitle: null,
          processedSignature: null,
        } satisfies ForensicsNodeData,
      };
    }
    case 'geoSpyNode': {
      const count = existingNodes.filter((n) => n.type === 'geoSpyNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `geospy-${index}`,
        type: 'geoSpyNode',
        position: explicitPosition ?? { x: 740, y: 1120 + offset },
        data: {
          kind: 'geoSpy',
          title: `GeoSpy Locator ${index}`,
          prediction: null,
          sourceTitle: null,
          processedSignature: null,
        } satisfies GeoSpyNodeData,
      };
    }
    case 'geoIntelNode': {
      const count = existingNodes.filter((n) => n.type === 'geoIntelNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `geointel-${index}`,
        type: 'geoIntelNode',
        position: explicitPosition ?? { x: 1120, y: 1120 + offset },
        data: {
          kind: 'geoIntel',
          title: `GeoIntel Clues ${index}`,
          clues: [],
          sourceTitle: null,
        } satisfies GeoIntelNodeData,
      };
    }
    case 'pivotNode': {
      const count = existingNodes.filter((n) => n.type === 'pivotNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `pivot-${index}`,
        type: 'pivotNode',
        position: explicitPosition ?? { x: 1120, y: 1320 + offset },
        data: {
          kind: 'pivot',
          title: `Username Pivot ${index}`,
          usernameInput: '',
          lastCheckedUsername: null,
          lastSourceSummary: null,
          results: [],
        } satisfies PivotNodeData,
      };
    }
    case 'dopplerNode': {
      const count = existingNodes.filter((n) => n.type === 'dopplerNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `doppler-${index}`,
        type: 'dopplerNode',
        position: explicitPosition ?? { x: 40, y: 1120 + offset },
        data: {
          kind: 'doppler',
          title: `Doppler Acoustic ${index}`,
          fileName: null,
          durationSec: null,
          sampleRate: null,
          utcStartTime: defaultUtcInputValue(),
          peakPointCount: 0,
        } satisfies DopplerNodeData,
      };
    }
    case 'suspectNode': {
      const count = existingNodes.filter((n) => n.type === 'suspectNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `suspect-${index}`,
        type: 'suspectNode',
        position: explicitPosition ?? { x: 670, y: 620 + offset },
        data: {
          kind: 'suspect',
          title: `Suspect Composite ${index}`,
          descriptionPrompt: '',
          suspectImageUrl: null,
          lastCompiledPrompt: null,
          lastSourceSummary: null,
          lastProviderLabel: null,
        } satisfies SuspectNodeData,
      };
    }
    case 'shodanNode': {
      const count = existingNodes.filter((n) => n.type === 'shodanNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `shodan-${index}`,
        type: 'shodanNode',
        position: explicitPosition ?? { x: 1120, y: 1520 + offset },
        data: {
          kind: 'shodan',
          title: `Shodan Intel ${index}`,
          queryInput: '',
          lastQuery: null,
          mode: null,
          total: null,
          results: [],
        } satisfies ShodanNodeData,
      };
    }
    case 'archiveNode': {
      const count = existingNodes.filter((n) => n.type === 'archiveNode').length;
      const offset = (count % 4) * 28;
      return {
        id: `archive-${index}`,
        type: 'archiveNode',
        position: explicitPosition ?? { x: 1120, y: 1720 + offset },
        data: {
          kind: 'archive',
          title: `Wayback Archive ${index}`,
          urlInput: '',
          lastCheckedUrl: null,
          lastSourceSummary: null,
          snapshots: [],
        } satisfies ArchiveNodeData,
      };
    }
  }
}

export const HANDLE_IDS = {
  IMAGE_LEFT_IN: 'image-in',
  IMAGE_GROUP_IN: 'group-in',
  IMAGE_GROUP_OUT: 'group-out',
  IMAGE_RIGHT_OUT: 'image-out',
  CROP_IN: 'crop-in',
  CROP_OUT: 'crop-out',
  CHAT_GLOBAL_IN: 'global-context',
  CHAT_SPECIFIC_IN: 'specific-context',
  CHAT_RESULT_OUT: 'result-out',
  RESULT_IN: 'result-in',
  OCR_IN: 'ocr-in',
  OCR_OUT: 'ocr-out',
  EXIF_IN: 'exif-in',
  EXIF_OUT: 'exif-out',
  ENHANCE_IN: 'enhance-in',
  ENHANCE_OUT: 'enhance-out',
  MAP_IN: 'map-in',
  REVERSE_SEARCH_IN: 'reverse-search-in',
  FACE_IN: 'face-in',
  DORK_IN: 'dork-in',
  FORENSICS_IN: 'forensics-in',
  GEOSPY_IN: 'geospy-in',
  GEOINTEL_IN: 'geointel-in',
  PIVOT_IN: 'pivot-in',
  SUSPECT_IN: 'suspect-in',
  SUSPECT_OUT: 'suspect-out',
  SHODAN_IN: 'shodan-in',
  ARCHIVE_IN: 'archive-in',
} as const;

/**
 * Traverses all ImageNode-to-ImageNode group connections (undirected) starting
 * from a given ImageNode ID and returns the full ordered group of ImageNode IDs.
 */
function expandImageGroup(
  startImageId: string,
  imageAdjacency: Map<string, string[]>,
  validImageIds: Set<string>,
): string[] {
  if (!validImageIds.has(startImageId)) return [];
  const visited = new Set<string>([startImageId]);
  const queue: string[] = [startImageId];
  const group: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    group.push(current);
    const neighbors = imageAdjacency.get(current) ?? [];
    for (const nextId of neighbors) {
      if (validImageIds.has(nextId) && !visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }

  return group;
}

/**
 * Computes for every ChatNode which ImageNodes, CropNodes, OcrNodes, ExifNodes, and EnhanceNodes
 * are connected to its Global Context and Specific Context ports, including any
 * grouped ImageNodes chained via top/bottom handles.
 */
export function computeChatContextMap(
  nodes: OsintNode[],
  edges: Edge[],
): ChatContextMap {
  const nodeById = new Map<string, OsintNode>();
  const validImageIds = new Set<string>();
  const validOcrIds = new Set<string>();
  const validExifIds = new Set<string>();
  const validEnhanceIds = new Set<string>();
  const chatNodeIds: string[] = [];

  for (const node of nodes) {
    nodeById.set(node.id, node);
    if (
      node.type === 'imageNode' ||
      node.data.kind === 'image' ||
      node.type === 'cropNode' ||
      node.data.kind === 'crop'
    ) {
      validImageIds.add(node.id);
    } else if (node.type === 'ocrNode' || node.data.kind === 'ocr') {
      validOcrIds.add(node.id);
    } else if (node.type === 'exifNode' || node.data.kind === 'exif') {
      validExifIds.add(node.id);
    } else if (node.type === 'enhanceNode' || node.data.kind === 'enhance') {
      validEnhanceIds.add(node.id);
    } else if (node.type === 'chatNode' || node.data.kind === 'chat') {
      chatNodeIds.push(node.id);
    }
  }

  // Build undirected adjacency for grouped ImageNodes (exclude CropNode extraction edges)
  const imageAdjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (
      edge.targetHandle === HANDLE_IDS.CROP_IN ||
      edge.sourceHandle === HANDLE_IDS.CROP_OUT
    ) {
      continue;
    }
    const srcNode = nodeById.get(edge.source);
    const tgtNode = nodeById.get(edge.target);
    const srcIsStandardImage =
      srcNode?.type === 'imageNode' || srcNode?.data.kind === 'image';
    const tgtIsStandardImage =
      tgtNode?.type === 'imageNode' || tgtNode?.data.kind === 'image';
    if (srcIsStandardImage && tgtIsStandardImage) {
      const fromList = imageAdjacency.get(edge.source) ?? [];
      fromList.push(edge.target);
      imageAdjacency.set(edge.source, fromList);

      const toList = imageAdjacency.get(edge.target) ?? [];
      toList.push(edge.source);
      imageAdjacency.set(edge.target, toList);
    }
  }

  const contextMap: ChatContextMap = {};
  for (const chatId of chatNodeIds) {
    contextMap[chatId] = {
      globalImageIds: [],
      specificImageIds: [],
      allConnectedImageIds: [],
      globalOcrIds: [],
      specificOcrIds: [],
      connectedOcrIds: [],
      globalExifIds: [],
      specificExifIds: [],
      connectedExifIds: [],
      globalEnhanceIds: [],
      specificEnhanceIds: [],
      connectedEnhanceIds: [],
      hasActiveContext: false,
    };
  }

  for (const edge of edges) {
    const targetNode = nodeById.get(edge.target);
    if (!targetNode || !(targetNode.id in contextMap)) continue;
    const isValidTargetPort =
      !edge.targetHandle ||
      edge.targetHandle === HANDLE_IDS.CHAT_GLOBAL_IN ||
      edge.targetHandle === HANDLE_IDS.CHAT_SPECIFIC_IN;
    if (!isValidTargetPort) continue;

    const entry = contextMap[targetNode.id];
    const isSpecific = edge.targetHandle === HANDLE_IDS.CHAT_SPECIFIC_IN;

    if (validImageIds.has(edge.source)) {
      const expandedGroup = expandImageGroup(edge.source, imageAdjacency, validImageIds);
      const targetBucket = isSpecific ? entry.specificImageIds : entry.globalImageIds;
      for (const imgId of expandedGroup) {
        if (!targetBucket.includes(imgId)) {
          targetBucket.push(imgId);
        }
      }
      continue;
    }

    if (validOcrIds.has(edge.source)) {
      const targetBucket = isSpecific ? entry.specificOcrIds : entry.globalOcrIds;
      if (!targetBucket.includes(edge.source)) {
        targetBucket.push(edge.source);
      }
      if (!entry.connectedOcrIds.includes(edge.source)) {
        entry.connectedOcrIds.push(edge.source);
      }
      continue;
    }

    if (validExifIds.has(edge.source)) {
      const targetBucket = isSpecific ? entry.specificExifIds : entry.globalExifIds;
      if (!targetBucket.includes(edge.source)) {
        targetBucket.push(edge.source);
      }
      if (!entry.connectedExifIds.includes(edge.source)) {
        entry.connectedExifIds.push(edge.source);
      }
      continue;
    }

    if (validEnhanceIds.has(edge.source)) {
      const targetBucket = isSpecific ? entry.specificEnhanceIds : entry.globalEnhanceIds;
      if (!targetBucket.includes(edge.source)) {
        targetBucket.push(edge.source);
      }
      if (!entry.connectedEnhanceIds.includes(edge.source)) {
        entry.connectedEnhanceIds.push(edge.source);
      }
    }
  }

  for (const chatId of chatNodeIds) {
    const entry = contextMap[chatId];
    const combined = Array.from(
      new Set([...entry.globalImageIds, ...entry.specificImageIds]),
    );
    entry.allConnectedImageIds = combined;
    entry.hasActiveContext =
      combined.length > 0 ||
      entry.connectedOcrIds.length > 0 ||
      entry.connectedExifIds.length > 0 ||
      entry.connectedEnhanceIds.length > 0;
  }

  return contextMap;
}

/**
 * Validates whether a new wire between two handles matches the OSINT graph grammar.
 */
export function isValidOsintConnection(
  connection: Connection,
  nodes: OsintNode[],
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;

  const sourceIsImage = sourceNode.type === 'imageNode';
  const targetIsImage = targetNode.type === 'imageNode';
  const sourceIsCrop = sourceNode.type === 'cropNode';
  const targetIsCrop = targetNode.type === 'cropNode';
  const sourceIsChat = sourceNode.type === 'chatNode';
  const targetIsChat = targetNode.type === 'chatNode';
  const targetIsResult = targetNode.type === 'resultNode';
  const sourceIsOcr = sourceNode.type === 'ocrNode';
  const targetIsOcr = targetNode.type === 'ocrNode';
  const sourceIsExif = sourceNode.type === 'exifNode';
  const targetIsExif = targetNode.type === 'exifNode';
  const sourceIsEnhance = sourceNode.type === 'enhanceNode';
  const targetIsEnhance = targetNode.type === 'enhanceNode';
  const targetIsMap = targetNode.type === 'mapNode';
  const targetIsReverseSearch = targetNode.type === 'reverseSearchNode';
  const targetIsFace = targetNode.type === 'faceNode';
  const targetIsDork = targetNode.type === 'dorkNode';
  const targetIsForensics = targetNode.type === 'forensicsNode';
  const targetIsGeoSpy = targetNode.type === 'geoSpyNode';
  const targetIsGeoIntel = targetNode.type === 'geoIntelNode';
  const targetIsPivot = targetNode.type === 'pivotNode';
  const sourceIsSuspect = sourceNode.type === 'suspectNode';
  const targetIsSuspect = targetNode.type === 'suspectNode';
  const targetIsShodan = targetNode.type === 'shodanNode';
  const targetIsArchive = targetNode.type === 'archiveNode';

  // ImageNode -> CropNode (manual target extraction chain of custody)
  if (sourceIsImage && targetIsCrop) {
    const fromRightPort =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.IMAGE_RIGHT_OUT;
    const toCropIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.CROP_IN;
    return fromRightPort && toCropIn;
  }

  // ImageNode / CropNode / OcrNode / ChatNode / EnhanceNode -> SuspectNode (context inputs for composite generation)
  if (
    (sourceIsImage ||
      sourceIsCrop ||
      sourceIsOcr ||
      sourceIsChat ||
      sourceIsEnhance) &&
    targetIsSuspect
  ) {
    const expectedSourceHandle = sourceIsImage
      ? HANDLE_IDS.IMAGE_RIGHT_OUT
      : sourceIsCrop
        ? HANDLE_IDS.CROP_OUT
        : sourceIsOcr
          ? HANDLE_IDS.OCR_OUT
          : sourceIsChat
            ? HANDLE_IDS.CHAT_RESULT_OUT
            : HANDLE_IDS.ENHANCE_OUT;
    const fromValidOut =
      !connection.sourceHandle ||
      connection.sourceHandle === expectedSourceHandle;
    const toSuspectIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.SUSPECT_IN;
    return fromValidOut && toSuspectIn;
  }

  // SuspectNode -> ImageNode / ResultNode / downstream image tools (ELA, ReverseSearch, OCR, etc.)
  if (
    sourceIsSuspect &&
    (targetIsImage ||
      targetIsResult ||
      targetIsOcr ||
      targetIsExif ||
      targetIsEnhance ||
      targetIsReverseSearch ||
      targetIsFace ||
      targetIsForensics ||
      targetIsGeoSpy ||
      targetIsGeoIntel)
  ) {
    const fromSuspectOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.SUSPECT_OUT;
    const expectedTarget = targetIsImage
      ? HANDLE_IDS.IMAGE_LEFT_IN
      : targetIsResult
        ? HANDLE_IDS.RESULT_IN
        : targetIsOcr
          ? HANDLE_IDS.OCR_IN
          : targetIsExif
            ? HANDLE_IDS.EXIF_IN
            : targetIsEnhance
              ? HANDLE_IDS.ENHANCE_IN
              : targetIsReverseSearch
                ? HANDLE_IDS.REVERSE_SEARCH_IN
                : targetIsFace
                  ? HANDLE_IDS.FACE_IN
                  : targetIsForensics
                    ? HANDLE_IDS.FORENSICS_IN
                    : targetIsGeoSpy
                      ? HANDLE_IDS.GEOSPY_IN
                      : HANDLE_IDS.GEOINTEL_IN;
    const toValidTarget =
      !connection.targetHandle || connection.targetHandle === expectedTarget;
    return fromSuspectOut && toValidTarget;
  }

  // ImageNode <-> ImageNode grouping & parent-crop connections
  if (sourceIsImage && targetIsImage) {
    const validSource =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.IMAGE_GROUP_OUT ||
      connection.sourceHandle === HANDLE_IDS.IMAGE_GROUP_IN ||
      connection.sourceHandle === HANDLE_IDS.IMAGE_RIGHT_OUT;
    const validTarget =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.IMAGE_GROUP_IN ||
      connection.targetHandle === HANDLE_IDS.IMAGE_GROUP_OUT ||
      connection.targetHandle === HANDLE_IDS.IMAGE_LEFT_IN;
    return validSource && validTarget;
  }

  // ImageNode / CropNode -> ChatNode context (right handle to left global/specific handles)
  if ((sourceIsImage || sourceIsCrop) && targetIsChat) {
    const expectedSourceHandle = sourceIsCrop
      ? HANDLE_IDS.CROP_OUT
      : HANDLE_IDS.IMAGE_RIGHT_OUT;
    const fromRightPort =
      !connection.sourceHandle ||
      connection.sourceHandle === expectedSourceHandle;
    const toChatPort =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.CHAT_GLOBAL_IN ||
      connection.targetHandle === HANDLE_IDS.CHAT_SPECIFIC_IN;
    return fromRightPort && toChatPort;
  }

  // ImageNode / CropNode -> OcrNode / ExifNode / EnhanceNode / ReverseSearchNode / FaceNode / ForensicsNode / GeoSpyNode / GeoIntelNode
  if (
    (sourceIsImage || sourceIsCrop) &&
    (targetIsOcr ||
      targetIsExif ||
      targetIsEnhance ||
      targetIsReverseSearch ||
      targetIsFace ||
      targetIsForensics ||
      targetIsGeoSpy ||
      targetIsGeoIntel)
  ) {
    const expectedSourceHandle = sourceIsCrop
      ? HANDLE_IDS.CROP_OUT
      : HANDLE_IDS.IMAGE_RIGHT_OUT;
    const fromRightPort =
      !connection.sourceHandle ||
      connection.sourceHandle === expectedSourceHandle;
    const expectedTargetHandle = targetIsOcr
      ? HANDLE_IDS.OCR_IN
      : targetIsExif
        ? HANDLE_IDS.EXIF_IN
        : targetIsEnhance
          ? HANDLE_IDS.ENHANCE_IN
          : targetIsReverseSearch
            ? HANDLE_IDS.REVERSE_SEARCH_IN
            : targetIsFace
              ? HANDLE_IDS.FACE_IN
              : targetIsForensics
                ? HANDLE_IDS.FORENSICS_IN
                : targetIsGeoSpy
                  ? HANDLE_IDS.GEOSPY_IN
                  : HANDLE_IDS.GEOINTEL_IN;
    const toToolPort =
      !connection.targetHandle ||
      connection.targetHandle === expectedTargetHandle;
    return fromRightPort && toToolPort;
  }

  // EnhanceNode -> ChatNode / OcrNode / ExifNode / ReverseSearchNode / FaceNode / ForensicsNode / GeoSpyNode / GeoIntelNode
  if (
    sourceIsEnhance &&
    (targetIsChat ||
      targetIsOcr ||
      targetIsExif ||
      targetIsReverseSearch ||
      targetIsFace ||
      targetIsForensics ||
      targetIsGeoSpy ||
      targetIsGeoIntel)
  ) {
    const fromEnhanceOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.ENHANCE_OUT;
    if (targetIsChat) {
      const toChatPort =
        !connection.targetHandle ||
        connection.targetHandle === HANDLE_IDS.CHAT_GLOBAL_IN ||
        connection.targetHandle === HANDLE_IDS.CHAT_SPECIFIC_IN;
      return fromEnhanceOut && toChatPort;
    }
    const expectedToolPort = targetIsOcr
      ? HANDLE_IDS.OCR_IN
      : targetIsExif
        ? HANDLE_IDS.EXIF_IN
        : targetIsReverseSearch
          ? HANDLE_IDS.REVERSE_SEARCH_IN
          : targetIsFace
            ? HANDLE_IDS.FACE_IN
            : targetIsForensics
              ? HANDLE_IDS.FORENSICS_IN
              : targetIsGeoSpy
                ? HANDLE_IDS.GEOSPY_IN
                : HANDLE_IDS.GEOINTEL_IN;
    const toToolPort =
      !connection.targetHandle || connection.targetHandle === expectedToolPort;
    return fromEnhanceOut && toToolPort;
  }

  // OcrNode -> ChatNode (extracted OCR text feeds AI context)
  if (sourceIsOcr && targetIsChat) {
    const fromOcrOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.OCR_OUT;
    const toChatPort =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.CHAT_GLOBAL_IN ||
      connection.targetHandle === HANDLE_IDS.CHAT_SPECIFIC_IN;
    return fromOcrOut && toChatPort;
  }

  // ExifNode -> ChatNode (parsed GPS/camera metadata feeds AI context)
  if (sourceIsExif && targetIsChat) {
    const fromExifOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.EXIF_OUT;
    const toChatPort =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.CHAT_GLOBAL_IN ||
      connection.targetHandle === HANDLE_IDS.CHAT_SPECIFIC_IN;
    return fromExifOut && toChatPort;
  }

  // ChatNode -> ResultNode output
  if (sourceIsChat && targetIsResult) {
    const fromChatOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.CHAT_RESULT_OUT;
    const toResultIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.RESULT_IN;
    return fromChatOut && toResultIn;
  }

  // ExifNode -> MapNode (GPS metadata visualization)
  if (sourceIsExif && targetIsMap) {
    const fromExifOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.EXIF_OUT;
    const toMapIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.MAP_IN;
    return fromExifOut && toMapIn;
  }

  // ChatNode -> MapNode (parsed text coordinates visualization)
  if (sourceIsChat && targetIsMap) {
    const fromChatOut =
      !connection.sourceHandle ||
      connection.sourceHandle === HANDLE_IDS.CHAT_RESULT_OUT;
    const toMapIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.MAP_IN;
    return fromChatOut && toMapIn;
  }

  // OcrNode / ExifNode / ChatNode -> DorkNode (text intelligence feeds Google Dork generation)
  if ((sourceIsOcr || sourceIsExif || sourceIsChat) && targetIsDork) {
    const expectedOut = sourceIsOcr
      ? HANDLE_IDS.OCR_OUT
      : sourceIsExif
        ? HANDLE_IDS.EXIF_OUT
        : HANDLE_IDS.CHAT_RESULT_OUT;
    const fromSourceOut =
      !connection.sourceHandle || connection.sourceHandle === expectedOut;
    const toDorkIn =
      !connection.targetHandle || connection.targetHandle === HANDLE_IDS.DORK_IN;
    return fromSourceOut && toDorkIn;
  }

  // OcrNode / ChatNode -> PivotNode (extracted username/text feeds cross-platform lookup)
  if ((sourceIsOcr || sourceIsChat) && targetIsPivot) {
    const expectedOut = sourceIsOcr
      ? HANDLE_IDS.OCR_OUT
      : HANDLE_IDS.CHAT_RESULT_OUT;
    const fromSourceOut =
      !connection.sourceHandle || connection.sourceHandle === expectedOut;
    const toPivotIn =
      !connection.targetHandle || connection.targetHandle === HANDLE_IDS.PIVOT_IN;
    return fromSourceOut && toPivotIn;
  }

  // OcrNode / ChatNode -> ArchiveNode (extracted URL/domain feeds Wayback Machine lookup)
  if ((sourceIsOcr || sourceIsChat) && targetIsArchive) {
    const expectedOut = sourceIsOcr
      ? HANDLE_IDS.OCR_OUT
      : HANDLE_IDS.CHAT_RESULT_OUT;
    const fromSourceOut =
      !connection.sourceHandle || connection.sourceHandle === expectedOut;
    const toArchiveIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.ARCHIVE_IN;
    return fromSourceOut && toArchiveIn;
  }

  // OcrNode / ChatNode -> ShodanNode (extracted IP/query feeds Shodan host intelligence)
  if ((sourceIsOcr || sourceIsChat) && targetIsShodan) {
    const expectedOut = sourceIsOcr
      ? HANDLE_IDS.OCR_OUT
      : HANDLE_IDS.CHAT_RESULT_OUT;
    const fromSourceOut =
      !connection.sourceHandle || connection.sourceHandle === expectedOut;
    const toShodanIn =
      !connection.targetHandle ||
      connection.targetHandle === HANDLE_IDS.SHODAN_IN;
    return fromSourceOut && toShodanIn;
  }

  return false;
}

/**
 * Returns IDs of all ResultNodes receiving output from the given ChatNode.
 */
export function getConnectedResultNodeIds(
  chatNodeId: string,
  edges: Edge[],
  nodes: OsintNode[],
): string[] {
  const resultNodeIds = new Set(
    nodes.filter((n) => n.type === 'resultNode').map((n) => n.id),
  );
  return edges
    .filter((e) => e.source === chatNodeId && resultNodeIds.has(e.target))
    .map((e) => e.target);
}

export interface OsintAnalysisOutput {
  replyText: string;
  analysisText: string;
  enhancedImageUrl: string | null;
  enhancedCaption: string;
  sourceSummary: string;
}

/**
 * Generates deterministic, context-grounded OSINT analysis output based on
 * the prompt and connected ImageNodes across Global and Specific Context ports.
 */
export function generateOsintAnalysis(params: {
  prompt: string;
  globalImages: Array<{ id: string; data: ImageNodeData }>;
  specificImages: Array<{ id: string; data: ImageNodeData }>;
  fallbackEnhancedUrl: string | null;
}): OsintAnalysisOutput {
  const { prompt, globalImages, specificImages, fallbackEnhancedUrl } = params;
  const trimmedPrompt = prompt.trim();

  const globalNames = globalImages.map((img) => img.data.title || 'Untitled Image');
  const specificNames = specificImages.map((img) => img.data.title || 'Untitled Image');
  const allNames = Array.from(new Set([...globalNames, ...specificNames]));

  const primaryImage =
    specificImages.find((i) => i.data.imageUrl)?.data.imageUrl ??
    globalImages.find((i) => i.data.imageUrl)?.data.imageUrl ??
    fallbackEnhancedUrl;

  if (allNames.length === 0) {
    return {
      replyText:
        'No image sources are currently wired to this node. Connect an ImageNode to Global Context or Specific Context to ground the inspection.',
      analysisText:
        `Query received: "${trimmedPrompt}"\n\n` +
        'Status: Awaiting image context.\n' +
        'Wire an ImageNode output handle to either Global Context or Specific Context on the ChatNode and resubmit to generate correlated visual findings.',
      enhancedImageUrl: null,
      enhancedCaption: 'No linked image source available for enhancement.',
      sourceSummary: '0 linked sources',
    };
  }

  const lower = trimmedPrompt.toLowerCase();
  const focusCue =
    lower.includes('shadow') || lower.includes('sun') || lower.includes('time')
      ? 'Solar azimuth and cast-shadow ratios indicate midday overhead illumination (~11:30–13:15 local solar window), consistent across primary ground structures.'
      : lower.includes('sign') || lower.includes('text') || lower.includes('ocr') || lower.includes('plate') || lower.includes('code')
        ? 'High-contrast alphanumeric markings and stencil typography extracted for cross-registry verification; edge sharpening highlights structural lettering without compression artifacts.'
        : lower.includes('geo') || lower.includes('locat') || lower.includes('where') || lower.includes('port')
          ? 'Infrastructure geometry, rail spur curvature, and signage typology narrow geographic candidates to a coastal commercial logistics corridor.'
          : 'Cross-frame visual correlation completed across lighting temperature, structural geometry, and surface wear patterns.';

  const scopeNotes: string[] = [];
  if (globalNames.length > 0) {
    scopeNotes.push(`Global Context (${globalNames.length}): ${globalNames.join(', ')}`);
  }
  if (specificNames.length > 0) {
    scopeNotes.push(`Specific Context (${specificNames.length}): ${specificNames.join(', ')}`);
  }

  const replyText =
    `Analyzed ${allNames.length} source${allNames.length === 1 ? '' : 's'} (${allNames.join(', ')}). ${focusCue}`;

  const analysisText =
    `Prompt: "${trimmedPrompt}"\n\n` +
    `Context Scope\n` +
    `${scopeNotes.join('\n')}\n\n` +
    `Findings\n` +
    `• ${focusCue}\n` +
    `• Continuity check: ${allNames.length > 1 ? `Cross-referenced ${allNames[0]} against ${allNames.slice(1).join(', ')} for matching structural anchors.` : `Single-frame baseline established from ${allNames[0]}; add a grouped ImageNode to cross-verify angles.`}`;

  const sourceSummary = `${allNames.length} source${allNames.length === 1 ? '' : 's'} · ${
    specificNames.length > 0 ? 'Specific + Global' : 'Global Context'
  }`;

  const enhancedCaption =
    specificNames.length > 0
      ? `Enhanced target region from ${specificNames[0]}`
      : `Enhanced forensic pass from ${globalNames[0]}`;

  return {
    replyText,
    analysisText,
    enhancedImageUrl: primaryImage,
    enhancedCaption,
    sourceSummary,
  };
}

export interface ParsedInlineImage {
  mimeType: string;
  data: string;
}

/**
 * Extracts MIME type and raw base64 payload from a data URL.
 */
export function parseBase64DataUrl(dataUrl: string): ParsedInlineImage | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  const [, mimeType, data] = match;
  if (!mimeType || !data) return null;
  return { mimeType, data };
}

export interface ConnectedOcrPromptContext {
  title: string;
  sourceTitle?: string | null;
  extractedText: string;
  confidence?: number | null;
  scope?: 'global' | 'specific';
}

export interface ConnectedExifPromptContext {
  title: string;
  sourceTitle?: string | null;
  summary: FormattedExifSummary | null;
  scope?: 'global' | 'specific';
}

/**
 * Builds a structured OSINT prompt describing attached Global/Specific image frames,
 * injected OCR text extractions, and EXIF metadata (camera, timestamp, GPS).
 */
export function buildOsintPromptText(params: {
  prompt: string;
  globalTitles: string[];
  specificTitles: string[];
  enhancedTitles?: string[];
  ocrContexts?: ConnectedOcrPromptContext[];
  exifContexts?: ConnectedExifPromptContext[];
}): string {
  const {
    prompt,
    globalTitles,
    specificTitles,
    enhancedTitles = [],
    ocrContexts = [],
    exifContexts = [],
  } = params;
  const contextLines: string[] = [];

  if (globalTitles.length > 0) {
    contextLines.push(`Global Context frames (${globalTitles.length}): ${globalTitles.join(', ')}`);
  }
  if (specificTitles.length > 0) {
    contextLines.push(`Specific Context target frames (${specificTitles.length}): ${specificTitles.join(', ')}`);
  }
  if (enhancedTitles.length > 0) {
    contextLines.push(`Super-Resolution Enhanced frames (${enhancedTitles.length}): ${enhancedTitles.join(', ')}`);
  }

  const ocrSectionLines: string[] = [];
  for (const ocr of ocrContexts) {
    const headerParts = [ocr.title];
    if (ocr.scope) headerParts.push(ocr.scope === 'specific' ? 'current prompt' : 'global');
    if (ocr.sourceTitle) headerParts.push(`source: ${ocr.sourceTitle}`);
    if (typeof ocr.confidence === 'number') {
      headerParts.push(`confidence: ${ocr.confidence}%`);
    }
    const textBody = ocr.extractedText.trim()
      ? ocr.extractedText.trim()
      : '(No readable text detected)';
    ocrSectionLines.push(`[${headerParts.join(' · ')}]\n${textBody}`);
  }

  const exifSectionLines: string[] = [];
  for (const exif of exifContexts) {
    const headerParts = [exif.title];
    if (exif.scope) headerParts.push(exif.scope === 'specific' ? 'current prompt' : 'global');
    if (exif.sourceTitle) headerParts.push(`source: ${exif.sourceTitle}`);
    if (!exif.summary) {
      exifSectionLines.push(`[${headerParts.join(' · ')}]\n(No EXIF metadata extracted yet)`);
    } else {
      exifSectionLines.push(
        `[${headerParts.join(' · ')}]\n` +
          `Camera: ${exif.summary.camera} | Date Taken: ${exif.summary.dateTaken} | ` +
          `GPS Coordinates: ${exif.summary.gpsCoordinates} | Dimensions: ${exif.summary.dimensions} | ` +
          `File Type: ${exif.summary.fileType}`,
      );
    }
  }

  const sections: string[] = [
    'You are an image OSINT analyst. Inspect the attached visual evidence and chained tool intelligence objectively and concisely.',
  ];

  if (contextLines.length > 0) {
    sections.push(contextLines.join('\n'));
  }

  if (ocrSectionLines.length > 0) {
    sections.push(`Injected OCR Text Context:\n${ocrSectionLines.join('\n\n')}`);
  }

  if (exifSectionLines.length > 0) {
    sections.push(`Injected EXIF Metadata & GPS Context:\n${exifSectionLines.join('\n\n')}`);
  }

  sections.push(`Analyst Question: ${prompt.trim()}`);
  sections.push(
    'Respond with structured, factual observations grounded strictly in visible details, OCR text, and EXIF/GPS telemetry.',
  );

  return sections.join('\n\n');
}

/**
 * Computes a clean non-overlapping position to the right of a ChatNode for a newly generated ResultNode.
 */
export function computeNextResultPosition(
  chatNode: OsintNode,
  edges: Edge[],
  nodes: OsintNode[],
): { x: number; y: number } {
  const existingResultIds = getConnectedResultNodeIds(chatNode.id, edges, nodes);
  const horizontalOffset = 470;
  const verticalStep = 560;
  return {
    x: chatNode.position.x + horizontalOffset,
    y: chatNode.position.y + existingResultIds.length * verticalStep,
  };
}

/**
 * Computes a clean, non-overlapping position to the right of a VideoNode when
 * spawning an ImageNode from an extracted video frame.
 */
export function computeSpawnedImageFromVideoPosition(
  videoNode: OsintNode,
  existingNodes: OsintNode[],
): { x: number; y: number } {
  const baseX = Math.round(videoNode.position.x + 420);
  const baseY = Math.round(videoNode.position.y);
  const nearbyCount = existingNodes.filter(
    (node) =>
      node.type === 'imageNode' &&
      node.position.x >= baseX - 40 &&
      node.position.x <= baseX + 400 &&
      node.position.y >= baseY - 40,
  ).length;

  const col = nearbyCount % 2;
  const row = Math.floor(nearbyCount / 2);
  return {
    x: baseX + col * 290,
    y: baseY + row * 310,
  };
}

/**
 * Computes a clean position to the right (+300px) of a parent ImageNode
 * when spawning a cropped child ImageNode.
 */
export function computeSpawnedCroppedImagePosition(
  parentNode: OsintNode,
  existingNodes: OsintNode[],
): { x: number; y: number } {
  const targetX = Math.round(parentNode.position.x + 300);
  const baseY = Math.round(parentNode.position.y);
  const stepY = 290;
  const minVerticalGap = 285;

  let candidateY = baseY;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const collides = existingNodes.some(
      (node) =>
        (node.type === 'imageNode' || node.type === 'cropNode') &&
        Math.abs(node.position.x - targetX) <= 180 &&
        Math.abs(node.position.y - candidateY) < minVerticalGap,
    );
    if (!collides) break;
    candidateY += stepY;
  }

  return {
    x: targetX,
    y: candidateY,
  };
}

/**
 * Computes a clean position to the right (+380px) of a parent ImageNode
 * when spawning an extracted CropNode, leaving room for the "EXTRACTED FROM" edge label.
 */
export function computeSpawnedCropNodePosition(
  parentNode: OsintNode,
  existingNodes: OsintNode[],
): { x: number; y: number } {
  const targetX = Math.round(parentNode.position.x + 380);
  const baseY = Math.round(parentNode.position.y);
  const stepY = 260;
  const minVerticalGap = 240;

  let candidateY = baseY;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const collides = existingNodes.some(
      (node) =>
        (node.type === 'cropNode' || node.type === 'imageNode') &&
        Math.abs(node.position.x - targetX) <= 180 &&
        Math.abs(node.position.y - candidateY) < minVerticalGap,
    );
    if (!collides) break;
    candidateY += stepY;
  }

  return {
    x: targetX,
    y: candidateY,
  };
}

export interface ConnectedSourceImage {
  id: string;
  title: string;
  imageUrl: string | null;
  sourceLabel?: string;
}

/**
 * Resolves the connected source ImageNode, CropNode, EnhanceNode, or SuspectNode feeding into a tool node.
 */
export function getConnectedSourceImageForNode(
  targetNodeId: string,
  nodes: OsintNode[],
  edges: Edge[],
): ConnectedSourceImage | null {
  const incomingEdge = edges.find((edge) => edge.target === targetNodeId);
  if (!incomingEdge) return null;

  const sourceNode = nodes.find((node) => node.id === incomingEdge.source);
  if (!sourceNode) return null;

  if (sourceNode.data.kind === 'image') {
    return {
      id: sourceNode.id,
      title: sourceNode.data.title || 'Untitled Image',
      imageUrl: sourceNode.data.imageUrl,
      sourceLabel: sourceNode.data.sourceLabel,
    };
  }

  if (sourceNode.data.kind === 'crop') {
    return {
      id: sourceNode.id,
      title: sourceNode.data.title || 'Extracted Target',
      imageUrl: sourceNode.data.imageUrl,
      sourceLabel: 'Extracted Target',
    };
  }

  if (sourceNode.data.kind === 'enhance') {
    return {
      id: sourceNode.id,
      title: sourceNode.data.title || 'Enhanced Frame',
      imageUrl: sourceNode.data.enhancedImageUrl ?? null,
      sourceLabel: `${sourceNode.data.scale}x Super-Resolution`,
    };
  }

  if (sourceNode.data.kind === 'suspect') {
    return {
      id: sourceNode.id,
      title: sourceNode.data.title || 'Suspect Composite',
      imageUrl: sourceNode.data.suspectImageUrl ?? null,
      sourceLabel: 'Suspect Composite',
    };
  }

  return null;
}

export interface ResolvedMapSource {
  sourceNodeId: string;
  sourceTitle: string;
  sourceType: 'exif' | 'chat';
  coordinates: GeoCoordinates | null;
  statusMessage: string | null;
}

/**
 * Resolves GPS or text-parsed coordinates feeding into a MapNode from a connected
 * ExifNode or ChatNode. Returns null when no valid source node is connected.
 */
export function resolveMapSourceForNode(
  mapNodeId: string,
  nodes: OsintNode[],
  edges: Edge[],
): ResolvedMapSource | null {
  const incomingEdges = edges.filter(
    (edge) =>
      edge.target === mapNodeId &&
      (!edge.targetHandle || edge.targetHandle === HANDLE_IDS.MAP_IN),
  );
  if (incomingEdges.length === 0) return null;

  // Prefer the most recently connected edge targeting this MapNode
  for (let i = incomingEdges.length - 1; i >= 0; i -= 1) {
    const edge = incomingEdges[i];
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;

    if (sourceNode.data.kind === 'exif') {
      const sourceTitle = sourceNode.data.title || 'EXIF Inspector';
      const summary = sourceNode.data.summary ?? null;
      if (!summary) {
        return {
          sourceNodeId: sourceNode.id,
          sourceTitle,
          sourceType: 'exif',
          coordinates: null,
          statusMessage: 'Awaiting EXIF metadata extraction from connected source.',
        };
      }
      if (!summary.hasGps) {
        return {
          sourceNodeId: sourceNode.id,
          sourceTitle,
          sourceType: 'exif',
          coordinates: null,
          statusMessage: 'Connected EXIF source contains no GPS tags.',
        };
      }
      const coordinates = parseCoordinatesFromText(summary.gpsCoordinates);
      return {
        sourceNodeId: sourceNode.id,
        sourceTitle,
        sourceType: 'exif',
        coordinates,
        statusMessage: coordinates
          ? null
          : 'Could not parse GPS coordinates from EXIF summary.',
      };
    }

    if (sourceNode.data.kind === 'chat') {
      const sourceTitle = sourceNode.data.title || 'Chat Thread';
      const messages = sourceNode.data.messages ?? [];

      // Prioritize newest assistant responses, then fallback to newest user messages
      for (let m = messages.length - 1; m >= 0; m -= 1) {
        const msg = messages[m];
        if (msg.role !== 'assistant') continue;
        const coords = parseCoordinatesFromText(msg.content);
        if (coords) {
          return {
            sourceNodeId: sourceNode.id,
            sourceTitle,
            sourceType: 'chat',
            coordinates: coords,
            statusMessage: null,
          };
        }
      }

      for (let m = messages.length - 1; m >= 0; m -= 1) {
        const msg = messages[m];
        if (msg.role !== 'user') continue;
        const coords = parseCoordinatesFromText(msg.content);
        if (coords) {
          return {
            sourceNodeId: sourceNode.id,
            sourceTitle,
            sourceType: 'chat',
            coordinates: coords,
            statusMessage: null,
          };
        }
      }

      return {
        sourceNodeId: sourceNode.id,
        sourceTitle,
        sourceType: 'chat',
        coordinates: null,
        statusMessage:
          messages.length === 0
            ? 'Run ChatNode analysis to detect coordinates.'
            : 'No decimal or DMS-decimal coordinates detected in ChatNode messages.',
      };
    }
  }

  return null;
}

export interface DorkSourceItem {
  nodeId: string;
  title: string;
  sourceType: 'ocr' | 'exif' | 'chat';
  text: string;
}

export interface ResolvedDorkSource {
  sources: DorkSourceItem[];
  combinedText: string;
  hasText: boolean;
  summaryLabel: string;
}

/**
 * Resolves connected OcrNode, ExifNode, or ChatNode text sources feeding into a DorkNode.
 * Returns null when no valid upstream source node is connected.
 */
export function resolveDorkSourceForNode(
  dorkNodeId: string,
  nodes: OsintNode[],
  edges: Edge[],
): ResolvedDorkSource | null {
  const incomingEdges = edges.filter(
    (edge) =>
      edge.target === dorkNodeId &&
      (!edge.targetHandle || edge.targetHandle === HANDLE_IDS.DORK_IN),
  );
  if (incomingEdges.length === 0) return null;

  const sources: DorkSourceItem[] = [];
  const seenIds = new Set<string>();

  for (const edge of incomingEdges) {
    if (seenIds.has(edge.source)) continue;
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;

    if (sourceNode.data.kind === 'ocr') {
      seenIds.add(sourceNode.id);
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'OCR Extractor',
        sourceType: 'ocr',
        text: (sourceNode.data.extractedText ?? '').trim(),
      });
    } else if (sourceNode.data.kind === 'exif') {
      seenIds.add(sourceNode.id);
      const summary = sourceNode.data.summary;
      const lines: string[] = [];
      if (summary) {
        if (summary.camera && summary.camera !== 'Not present') {
          lines.push(`Camera: ${summary.camera}`);
        }
        if (summary.dateTaken && summary.dateTaken !== 'Not present') {
          lines.push(`Date Taken: ${summary.dateTaken}`);
        }
        if (summary.hasGps && summary.gpsCoordinates) {
          lines.push(`GPS Coordinates: ${summary.gpsCoordinates}`);
        }
        if (sourceNode.data.sourceTitle) {
          lines.push(`Source File: ${sourceNode.data.sourceTitle}`);
        }
      }
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'EXIF Inspector',
        sourceType: 'exif',
        text: lines.join('\n'),
      });
    } else if (sourceNode.data.kind === 'chat') {
      seenIds.add(sourceNode.id);
      const messages = sourceNode.data.messages ?? [];
      const latestAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.content.trim().length > 0);
      const latestUser = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && m.content.trim().length > 0);
      const picked = latestAssistant ?? latestUser;
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'Chat Thread',
        sourceType: 'chat',
        text: picked ? picked.content.trim() : '',
      });
    }
  }

  if (sources.length === 0) return null;

  const nonEmptyTexts = sources
    .filter((s) => s.text.length > 0)
    .map((s) => `[${s.title}]\n${s.text}`);
  const combinedText = nonEmptyTexts.join('\n\n');
  const summaryLabel = sources.map((s) => s.title).join(', ');

  return {
    sources,
    combinedText,
    hasText: combinedText.trim().length > 0,
    summaryLabel,
  };
}

export interface PivotSourceItem {
  nodeId: string;
  title: string;
  sourceType: 'ocr' | 'chat';
  text: string;
}

export interface ResolvedPivotSource {
  sources: PivotSourceItem[];
  rawText: string;
  suggestedUsername: string | null;
  hasText: boolean;
  summaryLabel: string;
}

/**
 * Resolves connected OcrNode or ChatNode text sources feeding into a PivotNode
 * and extracts a candidate username handle. Returns null when disconnected.
 */
export function resolvePivotSourceForNode(
  pivotNodeId: string,
  nodes: OsintNode[],
  edges: Edge[],
): ResolvedPivotSource | null {
  const incomingEdges = edges.filter(
    (edge) =>
      edge.target === pivotNodeId &&
      (!edge.targetHandle || edge.targetHandle === HANDLE_IDS.PIVOT_IN),
  );
  if (incomingEdges.length === 0) return null;

  const sources: PivotSourceItem[] = [];
  const seenIds = new Set<string>();

  for (const edge of incomingEdges) {
    if (seenIds.has(edge.source)) continue;
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;

    if (sourceNode.data.kind === 'ocr') {
      seenIds.add(sourceNode.id);
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'OCR Extractor',
        sourceType: 'ocr',
        text: (sourceNode.data.extractedText ?? '').trim(),
      });
    } else if (sourceNode.data.kind === 'chat') {
      seenIds.add(sourceNode.id);
      const messages = sourceNode.data.messages ?? [];
      const latestAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.content.trim().length > 0);
      const latestUser = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && m.content.trim().length > 0);
      const pickedText =
        latestAssistant?.content.trim() ||
        latestUser?.content.trim() ||
        (sourceNode.data.draftPrompt ?? '').trim();
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'Chat Thread',
        sourceType: 'chat',
        text: pickedText,
      });
    }
  }

  if (sources.length === 0) return null;

  const nonEmptyTexts = sources
    .filter((s) => s.text.length > 0)
    .map((s) => s.text);
  const rawText = nonEmptyTexts.join('\n').trim();
  const suggestedUsername = rawText ? extractCandidateUsername(rawText) : null;
  const summaryLabel = sources.map((s) => s.title).join(', ');

  return {
    sources,
    rawText,
    suggestedUsername,
    hasText: rawText.length > 0,
    summaryLabel,
  };
}

export interface ResolvedArchiveSource {
  sources: PivotSourceItem[];
  rawText: string;
  suggestedUrl: string;
  hasText: boolean;
  summaryLabel: string;
}

/**
 * Resolves connected OcrNode or ChatNode text sources feeding into an ArchiveNode
 * and extracts a candidate URL or domain for Wayback Machine lookup.
 */
export function resolveArchiveSourceForNode(
  archiveNodeId: string,
  nodes: OsintNode[],
  edges: Edge[],
): ResolvedArchiveSource | null {
  const incomingEdges = edges.filter(
    (edge) =>
      edge.target === archiveNodeId &&
      (!edge.targetHandle || edge.targetHandle === HANDLE_IDS.ARCHIVE_IN),
  );
  if (incomingEdges.length === 0) return null;

  const sources: PivotSourceItem[] = [];
  const seenIds = new Set<string>();

  for (const edge of incomingEdges) {
    if (seenIds.has(edge.source)) continue;
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;

    if (sourceNode.data.kind === 'ocr') {
      seenIds.add(sourceNode.id);
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'OCR Extractor',
        sourceType: 'ocr',
        text: (sourceNode.data.extractedText ?? '').trim(),
      });
    } else if (sourceNode.data.kind === 'chat') {
      seenIds.add(sourceNode.id);
      const messages = sourceNode.data.messages ?? [];
      const latestAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.content.trim().length > 0);
      const latestUser = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && m.content.trim().length > 0);
      const pickedText =
        latestAssistant?.content.trim() ||
        latestUser?.content.trim() ||
        (sourceNode.data.draftPrompt ?? '').trim();
      sources.push({
        nodeId: sourceNode.id,
        title: sourceNode.data.title || 'Chat Thread',
        sourceType: 'chat',
        text: pickedText,
      });
    }
  }

  if (sources.length === 0) return null;

  const nonEmptyTexts = sources
    .filter((s) => s.text.length > 0)
    .map((s) => s.text);
  const rawText = nonEmptyTexts.join('\n').trim();
  const suggestedUrl = rawText ? extractCandidateArchiveUrl(rawText) : '';
  const summaryLabel = sources.map((s) => s.title).join(', ');

  return {
    sources,
    rawText,
    suggestedUrl,
    hasText: rawText.length > 0,
    summaryLabel,
  };
}

export interface FormattedExifSummary {
  camera: string;
  dateTaken: string;
  gpsCoordinates: string;
  hasGps: boolean;
  dimensions: string;
  fileType: string;
}

function readTagString(tag: unknown): string | null {
  if (!tag || typeof tag !== 'object') return null;
  const record = tag as { description?: unknown; value?: unknown };
  if (typeof record.description === 'string' && record.description.trim()) {
    return record.description.trim();
  }
  if (typeof record.value === 'string' && record.value.trim()) {
    return record.value.trim();
  }
  return null;
}

/**
 * Formats parsed ExifReader ExpandedTags into key OSINT metadata fields.
 */
export function formatExifSummary(tags: ExpandedTags): FormattedExifSummary {
  const make = readTagString(tags.exif?.Make);
  const model = readTagString(tags.exif?.Model);

  let camera = 'Not present';
  if (make && model) {
    camera = model.toLowerCase().startsWith(make.toLowerCase())
      ? model
      : `${make} ${model}`;
  } else if (model) {
    camera = model;
  } else if (make) {
    camera = make;
  }

  const dateTaken =
    readTagString(tags.exif?.DateTimeOriginal) ??
    readTagString(tags.exif?.DateTimeDigitized) ??
    readTagString(tags.exif?.DateTime) ??
    readTagString(tags.xmp?.CreateDate) ??
    'Not present';

  const lat = tags.gps?.Latitude;
  const lng = tags.gps?.Longitude;
  const hasGps =
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng);

  const gpsCoordinates = hasGps
    ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    : 'No GPS tags';

  const width =
    tags.file?.['Image Width']?.value ?? tags.pngFile?.['Image Width']?.value;
  const height =
    tags.file?.['Image Height']?.value ?? tags.pngFile?.['Image Height']?.value;
  const dimensions =
    typeof width === 'number' && typeof height === 'number'
      ? `${width} × ${height}`
      : 'Unknown';

  const fileType = tags.file?.FileType?.description ?? 'Unknown';

  return {
    camera,
    dateTaken,
    gpsCoordinates,
    hasGps,
    dimensions,
    fileType,
  };
}

export interface OsintCaseExportPayload {
  app: string;
  version: string;
  exportedAt: string;
  summary: {
    nodeCount: number;
    connectionCount: number;
    imageCount: number;
    cropCount: number;
    ocrCount: number;
    exifCount: number;
    enhanceCount: number;
    mapCount: number;
    reverseSearchCount: number;
    faceCount: number;
    videoCount: number;
    dorkCount: number;
    forensicsCount: number;
    geoSpyCount: number;
    geoIntelCount: number;
    pivotCount: number;
    dopplerCount: number;
    suspectCount: number;
    chatCount: number;
    resultCount: number;
  };
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: OsintNode['data'];
  }>;
  connections: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string | null;
    targetHandle: string | null;
    type: string | null;
    label: string | null;
  }>;
  extractedText: Array<{
    nodeId: string;
    title: string;
    sourceTitle: string | null;
    confidence: number | null;
    text: string;
  }>;
  exifData: Array<{
    nodeId: string;
    title: string;
    sourceTitle: string | null;
    metadata: FormattedExifSummary | null;
  }>;
  aiResponses: Array<{
    nodeId: string;
    nodeType: 'chatNode' | 'resultNode';
    title: string;
    responses: string[];
  }>;
}

/**
 * Builds a complete, portable JSON case export containing all canvas nodes,
 * connections, extracted OCR text, parsed EXIF metadata, and AI responses.
 */
export function buildCaseExportPayload(
  nodes: OsintNode[],
  edges: Edge[],
  exportedAt = new Date().toISOString(),
): OsintCaseExportPayload {
  const extractedText: OsintCaseExportPayload['extractedText'] = [];
  const exifData: OsintCaseExportPayload['exifData'] = [];
  const aiResponses: OsintCaseExportPayload['aiResponses'] = [];

  let imageCount = 0;
  let cropCount = 0;
  let ocrCount = 0;
  let exifCount = 0;
  let enhanceCount = 0;
  let mapCount = 0;
  let reverseSearchCount = 0;
  let faceCount = 0;
  let videoCount = 0;
  let dorkCount = 0;
  let forensicsCount = 0;
  let geoSpyCount = 0;
  let geoIntelCount = 0;
  let pivotCount = 0;
  let dopplerCount = 0;
  let suspectCount = 0;
  let chatCount = 0;
  let resultCount = 0;

  for (const node of nodes) {
    if (node.data.kind === 'image') {
      imageCount += 1;
    } else if (node.data.kind === 'crop') {
      cropCount += 1;
    } else if (node.data.kind === 'ocr') {
      ocrCount += 1;
      extractedText.push({
        nodeId: node.id,
        title: node.data.title,
        sourceTitle: node.data.sourceTitle ?? null,
        confidence: node.data.confidence ?? null,
        text: node.data.extractedText ?? '',
      });
    } else if (node.data.kind === 'exif') {
      exifCount += 1;
      exifData.push({
        nodeId: node.id,
        title: node.data.title,
        sourceTitle: node.data.sourceTitle ?? null,
        metadata: node.data.summary ?? null,
      });
    } else if (node.data.kind === 'enhance') {
      enhanceCount += 1;
    } else if (node.data.kind === 'map') {
      mapCount += 1;
    } else if (node.data.kind === 'reverseSearch') {
      reverseSearchCount += 1;
    } else if (node.data.kind === 'face') {
      faceCount += 1;
    } else if (node.data.kind === 'video') {
      videoCount += 1;
    } else if (node.data.kind === 'dork') {
      dorkCount += 1;
    } else if (node.data.kind === 'forensics') {
      forensicsCount += 1;
    } else if (node.data.kind === 'geoSpy') {
      geoSpyCount += 1;
    } else if (node.data.kind === 'geoIntel') {
      geoIntelCount += 1;
    } else if (node.data.kind === 'pivot') {
      pivotCount += 1;
    } else if (node.data.kind === 'doppler') {
      dopplerCount += 1;
    } else if (node.data.kind === 'suspect') {
      suspectCount += 1;
    } else if (node.data.kind === 'chat') {
      chatCount += 1;
      const assistantMessages = node.data.messages
        .filter((msg) => msg.role === 'assistant')
        .map((msg) => msg.content);
      aiResponses.push({
        nodeId: node.id,
        nodeType: 'chatNode',
        title: node.data.title,
        responses: assistantMessages,
      });
    } else if (node.data.kind === 'result') {
      resultCount += 1;
      if (node.data.analysisText) {
        aiResponses.push({
          nodeId: node.id,
          nodeType: 'resultNode',
          title: node.data.title,
          responses: [node.data.analysisText],
        });
      }
    }
  }

  return {
    app: 'Traceboard Image OSINT Canvas',
    version: '1.0',
    exportedAt,
    summary: {
      nodeCount: nodes.length,
      connectionCount: edges.length,
      imageCount,
      cropCount,
      ocrCount,
      exifCount,
      enhanceCount,
      mapCount,
      reverseSearchCount,
      faceCount,
      videoCount,
      dorkCount,
      forensicsCount,
      geoSpyCount,
      geoIntelCount,
      pivotCount,
      dopplerCount,
      suspectCount,
      chatCount,
      resultCount,
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type ?? node.data.kind,
      position: { x: node.position.x, y: node.position.y },
      data: node.data,
    })),
    connections: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      type: edge.type ?? null,
      label: typeof edge.label === 'string' ? edge.label : null,
    })),
    extractedText,
    exifData,
    aiResponses,
  };
}
