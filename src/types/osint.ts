import type { Edge, Node } from 'reactflow';
import type { FormattedExifSummary } from '../utils/osintGraph';
import type { DorkTargetType } from '../utils/dorkGenerator';
import type { GeoSpyPrediction } from '../utils/geoSpy';
import type { GeoIntelClue } from '../utils/geoIntel';
import type { PivotPlatformResult, PivotSource } from '../utils/usernamePivot';
import type { ShodanHostResult } from '../utils/shodanOsint';
import type { ArchiveSnapshot } from '../utils/archiveOsint';

export interface OsintProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  nodes: OsintNode[];
  edges: Edge[];
  nodeCounter?: number;
  nodeCount?: number;
  edgeCount?: number;
  isSummaryOnly?: boolean;
}

export interface ImageNodeData {
  kind: 'image';
  title: string;
  imageUrl: string | null;
  sourceLabel?: string;
  dimensions?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  contextSnapshot?: string[];
}

export interface ChatNodeData {
  kind: 'chat';
  title: string;
  messages: ChatMessage[];
  draftPrompt?: string;
}

export interface ResultNodeData {
  kind: 'result';
  title: string;
  analysisText: string;
  enhancedImageUrl: string | null;
  enhancedCaption: string;
  sourceSummary: string;
  updatedAt: string;
  isError?: boolean;
}

export interface OcrNodeData {
  kind: 'ocr';
  title: string;
  extractedText?: string;
  confidence?: number | null;
  sourceTitle?: string | null;
  processedSignature?: string | null;
}

export interface ExifNodeData {
  kind: 'exif';
  title: string;
  summary?: FormattedExifSummary | null;
  sourceTitle?: string | null;
  processedSignature?: string | null;
}

export type EnhanceScale = 2 | 4;

export interface EnhanceNodeData {
  kind: 'enhance';
  title: string;
  scale: EnhanceScale;
  enhancedImageUrl?: string | null;
  sourceDimensions?: string | null;
  outputDimensions?: string | null;
  sourceTitle?: string | null;
  processedSignature?: string | null;
}

export interface MapNodeData {
  kind: 'map';
  title: string;
}

export interface ReverseSearchNodeData {
  kind: 'reverseSearch';
  title: string;
}

export interface FaceNodeData {
  kind: 'face';
  title: string;
  faceCount?: number | null;
  sourceTitle?: string | null;
}

export interface VideoExtractedFrame {
  id: string;
  timestamp: number;
  label: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface VideoNodeData {
  kind: 'video';
  title: string;
  fileName?: string | null;
  duration?: number | null;
  intervalSeconds: number;
  selectedTimestamp: number;
  frames: VideoExtractedFrame[];
}

export interface DorkNodeData {
  kind: 'dork';
  title: string;
  targetType: DorkTargetType;
  dorks: string[];
  lastSourceSummary?: string | null;
}

export type ForensicsViewMode = 'ela' | 'original';

export interface ForensicsNodeData {
  kind: 'forensics';
  title: string;
  viewMode: ForensicsViewMode;
  elaImageUrl?: string | null;
  dimensions?: string | null;
  maxChannelDiff?: number | null;
  meanChannelDiff?: number | null;
  sourceTitle?: string | null;
  processedSignature?: string | null;
}

export interface GeoSpyNodeData {
  kind: 'geoSpy';
  title: string;
  prediction?: GeoSpyPrediction | null;
  sourceTitle?: string | null;
  processedSignature?: string | null;
}

export interface GeoIntelNodeData {
  kind: 'geoIntel';
  title: string;
  clues: GeoIntelClue[];
  sourceTitle?: string | null;
}

export interface PivotNodeData {
  kind: 'pivot';
  title: string;
  usernameInput: string;
  lastCheckedUsername?: string | null;
  lastSourceSummary?: string | null;
  source?: PivotSource | null;
  results: PivotPlatformResult[];
}

export interface DopplerNodeData {
  kind: 'doppler';
  title: string;
  fileName?: string | null;
  durationSec?: number | null;
  sampleRate?: number | null;
  utcStartTime: string;
  peakPointCount?: number;
}

export interface SuspectNodeData {
  kind: 'suspect';
  title: string;
  descriptionPrompt: string;
  suspectImageUrl: string | null;
  lastCompiledPrompt?: string | null;
  lastSourceSummary?: string | null;
  lastProviderLabel?: string | null;
}

export interface ShodanNodeData {
  kind: 'shodan';
  title: string;
  queryInput: string;
  lastQuery?: string | null;
  mode?: 'host' | 'search' | null;
  total?: number | null;
  results: ShodanHostResult[];
}

export interface ArchiveNodeData {
  kind: 'archive';
  title: string;
  urlInput: string;
  lastCheckedUrl?: string | null;
  lastSourceSummary?: string | null;
  snapshots: ArchiveSnapshot[];
}

export type OsintNodeData =
  | ImageNodeData
  | ChatNodeData
  | ResultNodeData
  | OcrNodeData
  | ExifNodeData
  | EnhanceNodeData
  | MapNodeData
  | ReverseSearchNodeData
  | FaceNodeData
  | VideoNodeData
  | DorkNodeData
  | ForensicsNodeData
  | GeoSpyNodeData
  | GeoIntelNodeData
  | PivotNodeData
  | DopplerNodeData
  | SuspectNodeData
  | ShodanNodeData
  | ArchiveNodeData;
export type OsintNode = Node<OsintNodeData>;

export type DeployableOsintNodeType =
  | 'imageNode'
  | 'chatNode'
  | 'resultNode'
  | 'ocrNode'
  | 'exifNode'
  | 'enhanceNode'
  | 'mapNode'
  | 'reverseSearchNode'
  | 'faceNode'
  | 'videoNode'
  | 'dorkNode'
  | 'forensicsNode'
  | 'geoSpyNode'
  | 'geoIntelNode'
  | 'pivotNode'
  | 'dopplerNode'
  | 'suspectNode'
  | 'shodanNode'
  | 'archiveNode';

export interface ChatContextEntry {
  globalImageIds: string[];
  specificImageIds: string[];
  allConnectedImageIds: string[];
  globalOcrIds: string[];
  specificOcrIds: string[];
  connectedOcrIds: string[];
  globalExifIds: string[];
  specificExifIds: string[];
  connectedExifIds: string[];
  globalEnhanceIds: string[];
  specificEnhanceIds: string[];
  connectedEnhanceIds: string[];
  hasActiveContext: boolean;
}

export type ChatContextMap = Record<string, ChatContextEntry>;
