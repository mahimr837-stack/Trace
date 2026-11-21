import { create } from 'zustand';
import {
  getProviderMeta,
  LLM_PROVIDERS,
  runMultiProviderAnalysis,
  type LlmProviderId,
} from '../utils/llmProviders';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from 'reactflow';
import type {
  ChatContextMap,
  ChatMessage,
  ChatNodeData,
  DeployableOsintNodeType,
  EnhanceNodeData,
  EnhanceScale,
  ExifNodeData,
  FaceNodeData,
  ImageNodeData,
  OcrNodeData,
  OsintNode,
  ResultNodeData,
  VideoExtractedFrame,
  VideoNodeData,
  DorkNodeData,
  ForensicsNodeData,
  ForensicsViewMode,
  GeoSpyNodeData,
  GeoIntelNodeData,
  PivotNodeData,
  DopplerNodeData,
  SuspectNodeData,
  ShodanNodeData,
  ArchiveNodeData,
  OsintProject,
} from '../types/osint';
import {
  buildOsintPromptText,
  computeChatContextMap,
  computeNextResultPosition,
  computeSpawnedCroppedImagePosition,
  computeSpawnedImageFromVideoPosition,
  type ConnectedExifPromptContext,
  type ConnectedOcrPromptContext,
  createOsintNode,
  getConnectedSourceImageForNode,
  HANDLE_IDS,
  isValidOsintConnection,
  parseBase64DataUrl,
  type ParsedInlineImage,
  resolveArchiveSourceForNode,
  resolveDorkSourceForNode,
} from '../utils/osintGraph';
import { formatCroppedNodeTitle } from '../utils/imageCrop';
import { buildVideoFrameTitle } from '../utils/videoFramesHelpers';
import { generateGoogleDorks } from '../utils/dorkGenerator';
import {
  getGlobalApiKey,
  getGlobalShodanApiKey,
  isApiAuthError,
  MISSING_API_KEY_MESSAGE,
  MISSING_SHODAN_KEY_MESSAGE,
  readGlobalSettings,
  saveGlobalSettings,
  saveGlobalShodanApiKey,
} from '../utils/globalSettings';
import {
  buildGeoIntelUserPrompt,
  GEOINTEL_SYSTEM_PROMPT,
  parseGeoIntelCluesResponse,
} from '../utils/geoIntel';
import { resolvePivotSourceForNode } from '../utils/osintGraph';
import {
  runBackendPivotCheck,
  sanitizeUsernameInput,
} from '../utils/usernamePivot';
import { runShodanSearch } from '../utils/shodanOsint';
import { runArchiveCheck } from '../utils/archiveOsint';
import {
  CANVAS_SAVE_DEBOUNCE_MS,
  createDebouncedTask,
  loadProjectsFromIdb,
  type PersistedProjectsState,
  saveProjectsToIdb,
  serializeProjectsState,
} from '../utils/canvasPersistence';
import {
  computeDagLayout,
  type DagLayoutDirection,
} from '../utils/dagLayout';
import {
  buildSuspectCompositePrompt,
  requestTargetImageGeneration,
  resolveSuspectContextForNode,
} from '../utils/suspectComposite';
import {
  deleteProjectOnServer,
  fetchProjectById,
  fetchProjectList,
  saveProjectToServer,
} from '../utils/projectApi';

const PORT_AERIAL_URL = '/src/assets/images/osint_port_aerial_1794763184788.jpg';
const STREET_SIGNAGE_URL = '/src/assets/images/osint_street_signage_1794763185376.jpg';
const ENHANCED_CROP_URL = '/src/assets/images/osint_enhanced_crop_1794763184939.jpg';

const INITIAL_NODES: OsintNode[] = [
  {
    id: 'img-1',
    type: 'imageNode',
    position: { x: 40, y: 110 },
    data: {
      kind: 'image',
      title: 'Port Terminal Aerial',
      imageUrl: PORT_AERIAL_URL,
      sourceLabel: 'Overhead Frame',
    },
  },
  {
    id: 'img-2',
    type: 'imageNode',
    position: { x: 40, y: 410 },
    data: {
      kind: 'image',
      title: 'Street Approach Signage',
      imageUrl: STREET_SIGNAGE_URL,
      sourceLabel: 'Ground Frame',
    },
  },
  {
    id: 'img-3',
    type: 'imageNode',
    position: { x: 340, y: 410 },
    data: {
      kind: 'image',
      title: 'Container ISO Detail',
      imageUrl: ENHANCED_CROP_URL,
      sourceLabel: 'Zoomed Target',
    },
  },
  {
    id: 'chat-1',
    type: 'chatNode',
    position: { x: 670, y: 110 },
    data: {
      kind: 'chat',
      title: 'Harbor Sector Inquiry',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Cross-check container markings and shadow azimuth across linked frames.',
          timestamp: '09:14',
          contextSnapshot: [
            'Port Terminal Aerial',
            'Street Approach Signage',
            'Container ISO Detail',
          ],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content:
            'Ready for live multimodal OSINT inspection. Click Models in the top-left toolbar to choose a provider and model, wire or upload images, and click Analyze to generate a connected ResultNode.',
          timestamp: '09:14',
        },
      ],
    },
  },
  {
    id: 'res-1',
    type: 'resultNode',
    position: { x: 1140, y: 110 },
    data: {
      kind: 'result',
      title: 'Forensic Output',
      analysisText:
        'Prompt: "Cross-check container markings and shadow azimuth across linked frames."\n\n' +
        'Context Scope\n' +
        'Global Context (2): Port Terminal Aerial, Street Approach Signage\n' +
        'Specific Context (1): Container ISO Detail\n\n' +
        'Findings\n' +
        '• Solar azimuth and cast-shadow ratios along the quay cranes indicate midday illumination.\n' +
        '• Specific target crop clarifies ISO container stencil MSCU 493026 0 adjacent to crane leg.',
      enhancedImageUrl: ENHANCED_CROP_URL,
      enhancedCaption: 'Reference target frame from Container ISO Detail',
      sourceSummary: '3 sources · Specific + Global',
      updatedAt: '09:14',
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: 'edge-group-img1-img2',
    source: 'img-1',
    target: 'img-2',
    sourceHandle: HANDLE_IDS.IMAGE_GROUP_OUT,
    targetHandle: HANDLE_IDS.IMAGE_GROUP_IN,
    type: 'redBezier',
  },
  {
    id: 'edge-img1-chat1-global',
    source: 'img-1',
    target: 'chat-1',
    sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
    targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    type: 'redBezier',
  },
  {
    id: 'edge-img3-chat1-specific',
    source: 'img-3',
    target: 'chat-1',
    sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
    targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
    type: 'redBezier',
  },
  {
    id: 'edge-chat1-res1',
    source: 'chat-1',
    target: 'res-1',
    sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
    targetHandle: HANDLE_IDS.RESULT_IN,
    type: 'redBezier',
  },
];

function formatNowTime(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function resolveImageToInlinePart(imageUrl: string): Promise<ParsedInlineImage | null> {
  const direct = parseBase64DataUrl(imageUrl);
  if (direct) return direct;

  // Convert local static asset URLs into base64 inlineData via fetch + FileReader
  const response = await fetch(imageUrl);
  if (!response.ok) return null;
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image data'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to convert image blob to base64'));
    reader.readAsDataURL(blob);
  });

  return parseBase64DataUrl(dataUrl);
}

const INITIAL_DEFAULT_PROJECT: OsintProject = {
  id: 'proj-harbor-1',
  name: 'Harbor Sector Inquiry',
  createdAt: '2026-11-18T09:14:00.000Z',
  nodes: INITIAL_NODES,
  edges: INITIAL_EDGES,
  nodeCounter: 4,
};

function extractSuspectUrlsFromNodes(
  nodes: OsintNode[],
): Record<string, string | null> {
  const urls: Record<string, string | null> = {};
  for (const node of nodes) {
    if (node.data.kind === 'suspect') {
      urls[node.id] = node.data.suspectImageUrl ?? null;
    }
  }
  return urls;
}

function syncActiveProjectInList(
  projects: OsintProject[],
  currentProjectId: string | null,
  nodes: OsintNode[],
  edges: Edge[],
  nodeCounter: number,
): OsintProject[] {
  if (!currentProjectId) return projects;
  let changed = false;
  const updated = projects.map((proj) => {
    if (proj.id !== currentProjectId) return proj;
    if (
      proj.nodes === nodes &&
      proj.edges === edges &&
      proj.nodeCounter === nodeCounter &&
      !proj.isSummaryOnly
    ) {
      return proj;
    }
    changed = true;
    return {
      ...proj,
      nodes,
      edges,
      nodeCounter,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      isSummaryOnly: false,
    };
  });
  return changed ? updated : projects;
}

const debouncedProjectsSaver = createDebouncedTask(
  async (payload: PersistedProjectsState) => {
    try {
      await saveProjectsToIdb(payload);
    } catch {
      // Ignore storage quota or private-browsing IndexedDB restrictions
    }
  },
  CANVAS_SAVE_DEBOUNCE_MS,
);

const debouncedServerProjectSaver = createDebouncedTask(
  async (project: OsintProject) => {
    try {
      await saveProjectToServer(project);
    } catch {
      // Ignore offline/network errors; IndexedDB still holds a local copy
    }
  },
  CANVAS_SAVE_DEBOUNCE_MS,
);

let suppressAutoSave = false;

export function flushPendingCanvasSave(): void {
  debouncedProjectsSaver.flush();
  debouncedServerProjectSaver.flush();
}

interface CanvasState {
  projects: OsintProject[];
  currentProjectId: string | null;
  nodes: OsintNode[];
  edges: Edge[];
  chatContextMap: ChatContextMap;
  nodeCounter: number;
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  shodanApiKey: string;
  providerConfigs: Record<LlmProviderId, { apiKey: string; model: string }>;
  alertMessage: string | null;
  analyzingChatIds: Record<string, boolean>;
  generatingDorkIds: Record<string, boolean>;
  extractingGeoIntelIds: Record<string, boolean>;
  pivotingNodeIds: Record<string, boolean>;
  searchingShodanIds: Record<string, boolean>;
  checkingArchiveIds: Record<string, boolean>;
  generatingSuspectIds: Record<string, boolean>;
  suspectImageUrls: Record<string, string | null>;
  geoSpyApiKeys: Record<string, string>;
  isHydrated: boolean;
  hasAttemptedHydration: boolean;
  createProject: (name: string) => string;
  deleteProject: (id: string) => void;
  renameProject: (id: string, newName: string) => void;
  loadProject: (id: string) => void;
  fetchProjectsFromServer: () => Promise<void>;
  setModelConfig: (config: {
    provider: LlmProviderId;
    apiKey: string;
    model: string;
  }) => void;
  setShodanApiKey: (shodanApiKey: string) => void;
  setAlertMessage: (message: string | null) => void;
  clearAlert: () => void;
  hydrateFromIndexedDb: () => Promise<void>;
  clearCanvas: () => Promise<void>;
  resetToSampleCanvas: () => void;
  autoLayoutNodes: (direction?: DagLayoutDirection) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  deleteEdge: (edgeId: string) => void;
  deployNode: (
    nodeType: DeployableOsintNodeType,
    position?: { x: number; y: number },
  ) => void;
  addImageNode: (position?: { x: number; y: number }) => void;
  addChatNode: (position?: { x: number; y: number }) => void;
  addResultNode: (position?: { x: number; y: number }) => void;
  addOcrNode: (position?: { x: number; y: number }) => void;
  addExifNode: (position?: { x: number; y: number }) => void;
  addEnhanceNode: (position?: { x: number; y: number }) => void;
  addMapNode: (position?: { x: number; y: number }) => void;
  addReverseSearchNode: (position?: { x: number; y: number }) => void;
  addFaceNode: (position?: { x: number; y: number }) => void;
  addVideoNode: (position?: { x: number; y: number }) => void;
  addDorkNode: (position?: { x: number; y: number }) => void;
  addForensicsNode: (position?: { x: number; y: number }) => void;
  addGeoSpyNode: (position?: { x: number; y: number }) => void;
  addGeoIntelNode: (position?: { x: number; y: number }) => void;
  addPivotNode: (position?: { x: number; y: number }) => void;
  addDopplerNode: (position?: { x: number; y: number }) => void;
  addSuspectNode: (position?: { x: number; y: number }) => void;
  updateImageNodeTitle: (nodeId: string, title: string) => void;
  updateImageNodeImage: (nodeId: string, imageUrl: string | null, sourceLabel?: string) => void;
  updateChatNodeTitle: (nodeId: string, title: string) => void;
  updateChatNodeDraftPrompt: (nodeId: string, draftPrompt: string) => void;
  updateOcrNodeData: (nodeId: string, patch: Partial<OcrNodeData>) => void;
  updateExifNodeData: (nodeId: string, patch: Partial<ExifNodeData>) => void;
  updateEnhanceNodeData: (nodeId: string, patch: Partial<EnhanceNodeData>) => void;
  updateFaceNodeData: (nodeId: string, patch: Partial<FaceNodeData>) => void;
  updateVideoNodeData: (nodeId: string, patch: Partial<VideoNodeData>) => void;
  updateDorkNodeData: (nodeId: string, patch: Partial<DorkNodeData>) => void;
  updateForensicsNodeData: (nodeId: string, patch: Partial<ForensicsNodeData>) => void;
  setForensicsNodeViewMode: (nodeId: string, viewMode: ForensicsViewMode) => void;
  updateGeoSpyNodeData: (nodeId: string, patch: Partial<GeoSpyNodeData>) => void;
  setGeoSpyApiKey: (nodeId: string, apiKey: string) => void;
  updateGeoIntelNodeData: (nodeId: string, patch: Partial<GeoIntelNodeData>) => void;
  updatePivotNodeData: (nodeId: string, patch: Partial<PivotNodeData>) => void;
  updateDopplerNodeData: (nodeId: string, patch: Partial<DopplerNodeData>) => void;
  updateSuspectNodeData: (nodeId: string, patch: Partial<SuspectNodeData>) => void;
  updateShodanNodeData: (nodeId: string, patch: Partial<ShodanNodeData>) => void;
  updateArchiveNodeData: (nodeId: string, patch: Partial<ArchiveNodeData>) => void;
  setSuspectImageUrl: (nodeId: string, suspectImageUrl: string | null) => void;
  spawnImageNodeFromVideoFrame: (
    videoNodeId: string,
    frame: VideoExtractedFrame,
  ) => string | null;
  spawnCroppedImageNode: (params: {
    parentNodeId: string;
    croppedImageUrl: string;
    dimensionsLabel?: string;
  }) => string | null;
  injectMobileImage: (params: {
    targetId?: string | null;
    imageBase64: string;
    position?: { x: number; y: number };
    title?: string;
  }) => { action: 'created' | 'updated'; nodeId: string };
  setEnhanceNodeScale: (nodeId: string, scale: EnhanceScale) => void;
  analyzeChatNode: (chatNodeId: string, prompt: string) => Promise<boolean>;
  generateDorksForNode: (
    dorkNodeId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  extractGeoIntelCluesForNode: (
    geoIntelNodeId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  runPivotForNode: (
    pivotNodeId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  runShodanForNode: (
    shodanNodeId: string,
    overrideApiKey?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  runArchiveForNode: (
    archiveNodeId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  generateSuspectImageForNode: (
    suspectNodeId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

const initialGlobalSettings = readGlobalSettings();

export const useCanvasStore = create<CanvasState>((set, get) => ({
  projects: [INITIAL_DEFAULT_PROJECT],
  currentProjectId: INITIAL_DEFAULT_PROJECT.id,
  nodes: INITIAL_NODES,
  edges: INITIAL_EDGES,
  chatContextMap: computeChatContextMap(INITIAL_NODES, INITIAL_EDGES),
  nodeCounter: 4,
  provider: initialGlobalSettings.provider,
  apiKey: initialGlobalSettings.apiKey,
  model: initialGlobalSettings.model,
  shodanApiKey: initialGlobalSettings.shodanApiKey,
  providerConfigs: initialGlobalSettings.providerConfigs,
  alertMessage: null,
  analyzingChatIds: {},
  generatingDorkIds: {},
  extractingGeoIntelIds: {},
  pivotingNodeIds: {},
  searchingShodanIds: {},
  checkingArchiveIds: {},
  generatingSuspectIds: {},
  suspectImageUrls: {},
  geoSpyApiKeys: {},
  isHydrated: false,
  hasAttemptedHydration: false,

  createProject: (name) => {
    const trimmedName =
      name.trim() || `Investigation #${get().projects.length + 1}`;
    const newProject: OsintProject = {
      id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmedName,
      createdAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      nodeCounter: 1,
      nodeCount: 0,
      edgeCount: 0,
      isSummaryOnly: false,
    };

    debouncedServerProjectSaver.flush();

    set((state) => {
      const syncedProjects = syncActiveProjectInList(
        state.projects,
        state.currentProjectId,
        state.nodes,
        state.edges,
        state.nodeCounter,
      );
      return {
        projects: [newProject, ...syncedProjects],
        currentProjectId: newProject.id,
        nodes: newProject.nodes,
        edges: newProject.edges,
        nodeCounter: 1,
        chatContextMap: {},
        suspectImageUrls: {},
        alertMessage: null,
      };
    });

    void saveProjectToServer(newProject).catch(() => {
      // Non-blocking: IndexedDB still captures the state if server is unreachable
    });

    return newProject.id;
  },

  deleteProject: (id) => {
    set((state) => {
      const syncedProjects = syncActiveProjectInList(
        state.projects,
        state.currentProjectId,
        state.nodes,
        state.edges,
        state.nodeCounter,
      );
      const nextProjects = syncedProjects.filter((p) => p.id !== id);
      if (state.currentProjectId !== id) {
        return {
          projects: nextProjects,
        };
      }

      const fallback = nextProjects[0] ?? null;
      if (!fallback) {
        return {
          projects: [],
          currentProjectId: null,
          nodes: [],
          edges: [],
          nodeCounter: 1,
          chatContextMap: {},
          suspectImageUrls: {},
          alertMessage: null,
        };
      }

      const nextCounter =
        fallback.nodeCounter ?? Math.max(fallback.nodes.length + 1, 1);

      return {
        projects: nextProjects,
        currentProjectId: fallback.id,
        nodes: fallback.nodes,
        edges: fallback.edges,
        nodeCounter: nextCounter,
        chatContextMap: computeChatContextMap(fallback.nodes, fallback.edges),
        suspectImageUrls: extractSuspectUrlsFromNodes(fallback.nodes),
        alertMessage: null,
      };
    });

    void deleteProjectOnServer(id).catch(() => {
      // Non-blocking if project was never written to disk
    });
  },

  renameProject: (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    const existingBefore = get().projects.find((p) => p.id === id);

    set((state) => ({
      projects: state.projects.map((proj) =>
        proj.id === id ? { ...proj, name: trimmed } : proj,
      ),
    }));

    if (existingBefore && !existingBefore.isSummaryOnly) {
      const updated = get().projects.find((p) => p.id === id);
      if (updated) {
        void saveProjectToServer(updated).catch(() => {});
      }
    } else {
      // Project was only loaded as a summary from /api/projects; fetch full JSON before saving the rename
      void fetchProjectById(id)
        .then((fullProject) => {
          if (!fullProject) return;
          const renamedProject: OsintProject = {
            ...fullProject,
            name: trimmed,
            isSummaryOnly: false,
          };
          suppressAutoSave = true;
          try {
            set((state) => ({
              projects: state.projects.map((p) =>
                p.id === id ? renamedProject : p,
              ),
            }));
          } finally {
            suppressAutoSave = false;
          }
          return saveProjectToServer(renamedProject);
        })
        .catch(() => {});
    }
  },

  loadProject: (id) => {
    debouncedServerProjectSaver.flush();

    suppressAutoSave = true;
    try {
      set((state) => {
        const currentProj = state.projects.find(
          (p) => p.id === state.currentProjectId,
        );
        const syncedProjects =
          currentProj && !currentProj.isSummaryOnly
            ? syncActiveProjectInList(
                state.projects,
                state.currentProjectId,
                state.nodes,
                state.edges,
                state.nodeCounter,
              )
            : state.projects;
        const target = syncedProjects.find((p) => p.id === id);
        if (!target) {
          return { projects: syncedProjects, currentProjectId: id };
        }

        const nextCounter =
          target.nodeCounter ?? Math.max(target.nodes.length + 1, 1);

        return {
          projects: syncedProjects,
          currentProjectId: target.id,
          nodes: target.nodes,
          edges: target.edges,
          nodeCounter: nextCounter,
          chatContextMap: computeChatContextMap(target.nodes, target.edges),
          suspectImageUrls: extractSuspectUrlsFromNodes(target.nodes),
          alertMessage: null,
          analyzingChatIds: {},
          generatingDorkIds: {},
          extractingGeoIntelIds: {},
          pivotingNodeIds: {},
          generatingSuspectIds: {},
        };
      });
    } finally {
      suppressAutoSave = false;
    }

    // Load full project JSON from backend filesystem (/api/projects/:id)
    void fetchProjectById(id)
      .then((diskProject) => {
        if (!diskProject) return;
        suppressAutoSave = true;
        try {
          set((state) => {
            const existsInList = state.projects.some(
              (p) => p.id === diskProject.id,
            );
            const nextProjects = existsInList
              ? state.projects.map((p) =>
                  p.id === diskProject.id ? diskProject : p,
                )
              : [diskProject, ...state.projects];

            if (state.currentProjectId !== diskProject.id) {
              return { projects: nextProjects };
            }

            const nextCounter =
              diskProject.nodeCounter ??
              Math.max(diskProject.nodes.length + 1, 1);

            return {
              projects: nextProjects,
              currentProjectId: diskProject.id,
              nodes: diskProject.nodes,
              edges: diskProject.edges,
              nodeCounter: nextCounter,
              chatContextMap: computeChatContextMap(
                diskProject.nodes,
                diskProject.edges,
              ),
              suspectImageUrls: extractSuspectUrlsFromNodes(diskProject.nodes),
            };
          });
        } finally {
          suppressAutoSave = false;
        }
      })
      .catch(() => {
        // Keep in-memory / IndexedDB project if server is unreachable
      });
  },

  fetchProjectsFromServer: async () => {
    try {
      const summaries = await fetchProjectList();
      suppressAutoSave = true;
      try {
        set((state) => {
          const existingById = new Map(state.projects.map((p) => [p.id, p]));
          const mergedProjects: OsintProject[] = summaries.map((summary) => {
            const existing = existingById.get(summary.id);
            if (existing && !existing.isSummaryOnly) {
              return {
                ...existing,
                name: summary.name,
                createdAt: summary.createdAt,
                updatedAt: summary.updatedAt,
                nodeCount: summary.nodeCount,
                edgeCount: summary.edgeCount,
              };
            }
            return {
              id: summary.id,
              name: summary.name,
              createdAt: summary.createdAt,
              updatedAt: summary.updatedAt,
              nodes: [],
              edges: [],
              nodeCounter: Math.max(summary.nodeCount + 1, 1),
              nodeCount: summary.nodeCount,
              edgeCount: summary.edgeCount,
              isSummaryOnly: true,
            };
          });

          const nextCurrentId =
            state.currentProjectId &&
            mergedProjects.some((p) => p.id === state.currentProjectId)
              ? state.currentProjectId
              : mergedProjects[0]?.id ?? null;

          return {
            projects: mergedProjects,
            currentProjectId: nextCurrentId,
            isHydrated: true,
            hasAttemptedHydration: true,
          };
        });
      } finally {
        suppressAutoSave = false;
      }
    } catch {
      // Leave current in-memory / IndexedDB projects intact when server is unreachable
    }
  },

  hydrateFromIndexedDb: async () => {
    if (get().hasAttemptedHydration) return;
    set({ hasAttemptedHydration: true });

    try {
      const serverSummaries = await fetchProjectList();
      if (serverSummaries.length > 0) {
        const mergedProjects: OsintProject[] = serverSummaries.map((s) => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          nodes: [],
          edges: [],
          nodeCounter: Math.max(s.nodeCount + 1, 1),
          nodeCount: s.nodeCount,
          edgeCount: s.edgeCount,
          isSummaryOnly: true,
        }));

        const firstId = mergedProjects[0].id;
        const firstFull = await fetchProjectById(firstId).catch(() => null);

        suppressAutoSave = true;
        try {
          if (firstFull) {
            const hydratedList = mergedProjects.map((p) =>
              p.id === firstFull.id ? firstFull : p,
            );
            const nextCounter =
              firstFull.nodeCounter ?? Math.max(firstFull.nodes.length + 1, 1);
            set({
              projects: hydratedList,
              currentProjectId: firstFull.id,
              nodes: firstFull.nodes,
              edges: firstFull.edges,
              nodeCounter: nextCounter,
              chatContextMap: computeChatContextMap(
                firstFull.nodes,
                firstFull.edges,
              ),
              suspectImageUrls: extractSuspectUrlsFromNodes(firstFull.nodes),
              isHydrated: true,
            });
          } else {
            set({
              projects: mergedProjects,
              currentProjectId: firstId,
              isHydrated: true,
            });
          }
        } finally {
          suppressAutoSave = false;
        }
        return;
      }

      // Server /data folder is currently empty — migrate any existing IndexedDB projects once
      const saved = await loadProjectsFromIdb().catch(() => null);
      suppressAutoSave = true;
      try {
        if (saved && saved.projects.length > 0) {
          for (const proj of saved.projects) {
            void saveProjectToServer(proj).catch(() => {});
          }
          const activeProject =
            saved.projects.find((p) => p.id === saved.currentProjectId) ??
            saved.projects[0];
          const nextCounter =
            activeProject.nodeCounter ??
            Math.max(activeProject.nodes.length + 1, 1);
          set({
            projects: saved.projects.map((p) => ({
              ...p,
              nodeCount: p.nodes.length,
              edgeCount: p.edges.length,
              isSummaryOnly: false,
            })),
            currentProjectId: activeProject.id,
            nodes: activeProject.nodes,
            edges: activeProject.edges,
            nodeCounter: nextCounter,
            chatContextMap: computeChatContextMap(
              activeProject.nodes,
              activeProject.edges,
            ),
            suspectImageUrls: extractSuspectUrlsFromNodes(activeProject.nodes),
            isHydrated: true,
          });
        } else {
          set({
            projects: [],
            currentProjectId: null,
            nodes: [],
            edges: [],
            nodeCounter: 1,
            chatContextMap: {},
            suspectImageUrls: {},
            isHydrated: true,
          });
        }
      } finally {
        suppressAutoSave = false;
      }
      return;
    } catch {
      // Fallback to IndexedDB when backend /api/projects is unavailable
    }

    try {
      const saved = await loadProjectsFromIdb();
      suppressAutoSave = true;
      if (saved) {
        const activeProject =
          saved.projects.find((p) => p.id === saved.currentProjectId) ??
          saved.projects[0] ??
          null;

        if (activeProject) {
          const nextCounter =
            activeProject.nodeCounter ??
            Math.max(activeProject.nodes.length + 1, 1);
          set({
            projects: saved.projects,
            currentProjectId: activeProject.id,
            nodes: activeProject.nodes,
            edges: activeProject.edges,
            nodeCounter: nextCounter,
            chatContextMap: computeChatContextMap(
              activeProject.nodes,
              activeProject.edges,
            ),
            suspectImageUrls: extractSuspectUrlsFromNodes(activeProject.nodes),
            isHydrated: true,
          });
        } else {
          set({
            projects: [],
            currentProjectId: null,
            nodes: [],
            edges: [],
            nodeCounter: 1,
            chatContextMap: {},
            suspectImageUrls: {},
            isHydrated: true,
          });
        }
      } else {
        set({ isHydrated: true });
      }
    } catch {
      suppressAutoSave = true;
      set({ isHydrated: true });
    } finally {
      suppressAutoSave = false;
    }
  },

  clearCanvas: async () => {
    set((state) => {
      const updatedProjects = syncActiveProjectInList(
        state.projects,
        state.currentProjectId,
        [],
        [],
        1,
      );
      return {
        projects: updatedProjects,
        nodes: [],
        edges: [],
        nodeCounter: 1,
        chatContextMap: {},
        alertMessage: null,
        analyzingChatIds: {},
        generatingDorkIds: {},
        extractingGeoIntelIds: {},
        pivotingNodeIds: {},
        generatingSuspectIds: {},
        suspectImageUrls: {},
        geoSpyApiKeys: {},
        isHydrated: true,
        hasAttemptedHydration: true,
      };
    });
  },

  resetToSampleCanvas: () => {
    set((state) => {
      const updatedProjects = syncActiveProjectInList(
        state.projects,
        state.currentProjectId,
        INITIAL_NODES,
        INITIAL_EDGES,
        4,
      );
      return {
        projects: updatedProjects,
        nodes: INITIAL_NODES,
        edges: INITIAL_EDGES,
        nodeCounter: 4,
        chatContextMap: computeChatContextMap(INITIAL_NODES, INITIAL_EDGES),
        alertMessage: null,
        analyzingChatIds: {},
      };
    });
  },

  autoLayoutNodes: (direction = 'LR') => {
    set((state) => {
      if (state.nodes.length === 0) return state;
      const nextNodes = computeDagLayout(state.nodes, state.edges, {
        direction,
      });
      return {
        nodes: nextNodes,
        chatContextMap: computeChatContextMap(nextNodes, state.edges),
      };
    });
  },

  setModelConfig: ({ provider, apiKey, model }) =>
    set((state) => {
      const nextConfigs = {
        ...state.providerConfigs,
        [provider]: { apiKey, model },
      };
      saveGlobalSettings({
        provider,
        apiKey,
        model,
        providerConfigs: nextConfigs,
      });
      return {
        provider,
        apiKey,
        model,
        providerConfigs: nextConfigs,
        alertMessage: null,
      };
    }),
  setShodanApiKey: (shodanApiKey) => {
    const trimmed = shodanApiKey.trim();
    saveGlobalShodanApiKey(trimmed);
    set({ shodanApiKey: trimmed, alertMessage: null });
  },
  setAlertMessage: (alertMessage) => set({ alertMessage }),
  clearAlert: () => set({ alertMessage: null }),

  onNodesChange: (changes) => {
    set((state) => {
      const nextNodes = applyNodeChanges(changes, state.nodes) as OsintNode[];
      return {
        nodes: nextNodes,
        chatContextMap: computeChatContextMap(nextNodes, state.edges),
      };
    });
  },

  onEdgesChange: (changes) => {
    set((state) => {
      const nextEdges = applyEdgeChanges(changes, state.edges);
      return {
        edges: nextEdges,
        chatContextMap: computeChatContextMap(state.nodes, nextEdges),
      };
    });
  },

  onConnect: (connection) => {
    const state = get();
    if (!isValidOsintConnection(connection, state.nodes)) {
      return;
    }

    const nextEdges = addEdge(
      {
        ...connection,
        type: 'redBezier',
      },
      state.edges,
    );

    const sourceNode = state.nodes.find((n) => n.id === connection.source);
    const suspectImageUrl =
      sourceNode && sourceNode.data.kind === 'suspect'
        ? state.suspectImageUrls[sourceNode.id] ?? sourceNode.data.suspectImageUrl
        : null;

    let nextNodes = state.nodes;
    if (sourceNode && sourceNode.data.kind === 'suspect' && suspectImageUrl) {
      const suspectData = sourceNode.data;
      const nowTime = formatNowTime();
      nextNodes = state.nodes.map((node) => {
        if (node.id !== connection.target) return node;
        if (node.data.kind === 'image') {
          return {
            ...node,
            data: {
              ...node.data,
              imageUrl: suspectImageUrl,
              sourceLabel: `From ${suspectData.title}`,
            } satisfies ImageNodeData,
          };
        }
        if (node.data.kind === 'result') {
          return {
            ...node,
            data: {
              ...node.data,
              enhancedImageUrl: suspectImageUrl,
              enhancedCaption: `Composite output from ${suspectData.title}`,
              analysisText:
                suspectData.lastCompiledPrompt ||
                suspectData.descriptionPrompt ||
                node.data.analysisText,
              sourceSummary:
                suspectData.lastProviderLabel || 'Suspect Composite',
              updatedAt: nowTime,
              isError: false,
            } satisfies ResultNodeData,
          };
        }
        return node;
      });
    }

    set({
      nodes: nextNodes,
      edges: nextEdges,
      chatContextMap: computeChatContextMap(nextNodes, nextEdges),
    });
  },

  deleteEdge: (edgeId) => {
    set((state) => {
      const nextEdges = state.edges.filter((edge) => edge.id !== edgeId);
      return {
        edges: nextEdges,
        chatContextMap: computeChatContextMap(state.nodes, nextEdges),
      };
    });
  },

  deployNode: (nodeType, position) => {
    set((state) => {
      const index = state.nodeCounter;
      const newNode = createOsintNode({
        nodeType,
        index,
        existingNodes: state.nodes,
        position,
      });
      const nextNodes = [...state.nodes, newNode];
      return {
        nodes: nextNodes,
        nodeCounter: index + 1,
        chatContextMap: computeChatContextMap(nextNodes, state.edges),
      };
    });
  },

  addImageNode: (position) => {
    get().deployNode('imageNode', position);
  },

  addChatNode: (position) => {
    get().deployNode('chatNode', position);
  },

  addResultNode: (position) => {
    get().deployNode('resultNode', position);
  },

  addOcrNode: (position) => {
    get().deployNode('ocrNode', position);
  },

  addExifNode: (position) => {
    get().deployNode('exifNode', position);
  },

  addEnhanceNode: (position) => {
    get().deployNode('enhanceNode', position);
  },

  addMapNode: (position) => {
    get().deployNode('mapNode', position);
  },

  addReverseSearchNode: (position) => {
    get().deployNode('reverseSearchNode', position);
  },

  addFaceNode: (position) => {
    get().deployNode('faceNode', position);
  },

  addVideoNode: (position) => {
    get().deployNode('videoNode', position);
  },

  addDorkNode: (position) => {
    get().deployNode('dorkNode', position);
  },

  addForensicsNode: (position) => {
    get().deployNode('forensicsNode', position);
  },

  addGeoSpyNode: (position) => {
    get().deployNode('geoSpyNode', position);
  },

  addGeoIntelNode: (position) => {
    get().deployNode('geoIntelNode', position);
  },

  addPivotNode: (position) => {
    get().deployNode('pivotNode', position);
  },

  addDopplerNode: (position) => {
    get().deployNode('dopplerNode', position);
  },

  addSuspectNode: (position) => {
    get().deployNode('suspectNode', position);
  },

  updateImageNodeTitle: (nodeId, title) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'image') return node;
        return {
          ...node,
          data: {
            ...node.data,
            title,
          } satisfies ImageNodeData,
        };
      }),
    }));
  },

  updateImageNodeImage: (nodeId, imageUrl, sourceLabel) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'image') return node;
        return {
          ...node,
          data: {
            ...node.data,
            imageUrl,
            sourceLabel: sourceLabel ?? node.data.sourceLabel,
          } satisfies ImageNodeData,
        };
      }),
    }));
  },

  updateChatNodeTitle: (nodeId, title) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'chat') return node;
        return {
          ...node,
          data: {
            ...node.data,
            title,
          } satisfies ChatNodeData,
        };
      }),
    }));
  },

  updateChatNodeDraftPrompt: (nodeId, draftPrompt) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'chat') return node;
        return {
          ...node,
          data: {
            ...node.data,
            draftPrompt,
          } satisfies ChatNodeData,
        };
      }),
    }));
  },

  updateOcrNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'ocr') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies OcrNodeData,
        };
      }),
    }));
  },

  updateExifNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'exif') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies ExifNodeData,
        };
      }),
    }));
  },

  updateEnhanceNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'enhance') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies EnhanceNodeData,
        };
      }),
    }));
  },

  updateFaceNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'face') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies FaceNodeData,
        };
      }),
    }));
  },

  updateVideoNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'video') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies VideoNodeData,
        };
      }),
    }));
  },

  updateDorkNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'dork') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies DorkNodeData,
        };
      }),
    }));
  },

  updateForensicsNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'forensics') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies ForensicsNodeData,
        };
      }),
    }));
  },

  setForensicsNodeViewMode: (nodeId, viewMode) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'forensics') return node;
        return {
          ...node,
          data: {
            ...node.data,
            viewMode,
          } satisfies ForensicsNodeData,
        };
      }),
    }));
  },

  updateGeoSpyNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'geoSpy') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies GeoSpyNodeData,
        };
      }),
    }));
  },

  setGeoSpyApiKey: (nodeId, apiKey) => {
    set((state) => ({
      geoSpyApiKeys: {
        ...state.geoSpyApiKeys,
        [nodeId]: apiKey,
      },
    }));
  },

  updateGeoIntelNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'geoIntel') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies GeoIntelNodeData,
        };
      }),
    }));
  },

  updatePivotNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'pivot') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies PivotNodeData,
        };
      }),
    }));
  },

  updateDopplerNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'doppler') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies DopplerNodeData,
        };
      }),
    }));
  },

  updateSuspectNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'suspect') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies SuspectNodeData,
        };
      }),
      ...(patch.suspectImageUrl !== undefined
        ? {
            suspectImageUrls: {
              ...state.suspectImageUrls,
              [nodeId]: patch.suspectImageUrl,
            },
          }
        : {}),
    }));
  },

  updateShodanNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'shodan') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies ShodanNodeData,
        };
      }),
    }));
  },

  updateArchiveNodeData: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'archive') return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...patch,
          } satisfies ArchiveNodeData,
        };
      }),
    }));
  },

  setSuspectImageUrl: (nodeId, suspectImageUrl) => {
    set((state) => {
      const suspectNode = state.nodes.find((n) => n.id === nodeId);
      const suspectTitle =
        suspectNode && suspectNode.data.kind === 'suspect'
          ? suspectNode.data.title
          : 'Suspect Composite';
      const downstreamTargetIds = new Set(
        state.edges
          .filter((e) => e.source === nodeId)
          .map((e) => e.target),
      );
      const nowTime = formatNowTime();

      const nextNodes = state.nodes.map((node) => {
        if (node.id === nodeId && node.data.kind === 'suspect') {
          return {
            ...node,
            data: {
              ...node.data,
              suspectImageUrl,
            } satisfies SuspectNodeData,
          };
        }
        if (downstreamTargetIds.has(node.id) && suspectImageUrl) {
          if (node.data.kind === 'image') {
            return {
              ...node,
              data: {
                ...node.data,
                imageUrl: suspectImageUrl,
                sourceLabel: `From ${suspectTitle}`,
              } satisfies ImageNodeData,
            };
          }
          if (node.data.kind === 'result') {
            return {
              ...node,
              data: {
                ...node.data,
                enhancedImageUrl: suspectImageUrl,
                enhancedCaption: `Composite output from ${suspectTitle}`,
                updatedAt: nowTime,
                isError: false,
              } satisfies ResultNodeData,
            };
          }
        }
        return node;
      });

      return {
        nodes: nextNodes,
        suspectImageUrls: {
          ...state.suspectImageUrls,
          [nodeId]: suspectImageUrl,
        },
        chatContextMap: computeChatContextMap(nextNodes, state.edges),
      };
    });
  },

  spawnImageNodeFromVideoFrame: (videoNodeId, frame) => {
    let createdId: string | null = null;
    set((state) => {
      const videoNode = state.nodes.find((n) => n.id === videoNodeId);
      const index = state.nodeCounter;
      const newImageId = `img-${index}`;
      createdId = newImageId;

      const position = videoNode
        ? computeSpawnedImageFromVideoPosition(videoNode, state.nodes)
        : { x: 460, y: 200 };

      const videoFileName =
        videoNode && videoNode.data.kind === 'video' ? videoNode.data.fileName : null;

      const spawnedImageNode: OsintNode = {
        id: newImageId,
        type: 'imageNode',
        position,
        data: {
          kind: 'image',
          title: buildVideoFrameTitle(videoFileName, frame.timestamp),
          imageUrl: frame.dataUrl,
          sourceLabel: `Video Frame · ${frame.label}`,
          dimensions: `${frame.width} × ${frame.height}`,
        } satisfies ImageNodeData,
      };

      const nextNodes = [...state.nodes, spawnedImageNode];
      return {
        nodes: nextNodes,
        nodeCounter: index + 1,
        chatContextMap: computeChatContextMap(nextNodes, state.edges),
      };
    });
    return createdId;
  },

  spawnCroppedImageNode: ({ parentNodeId, croppedImageUrl, dimensionsLabel }) => {
    let createdId: string | null = null;
    set((state) => {
      const parentNode = state.nodes.find((n) => n.id === parentNodeId);
      if (!parentNode || parentNode.data.kind !== 'image') return state;

      const index = state.nodeCounter;
      const newImageId = `img-${index}`;
      createdId = newImageId;

      const position = computeSpawnedCroppedImagePosition(
        parentNode,
        state.nodes,
      );
      const parentTitle = parentNode.data.title || 'Untitled Image';

      const croppedNode: OsintNode = {
        id: newImageId,
        type: 'imageNode',
        position,
        data: {
          kind: 'image',
          title: formatCroppedNodeTitle(parentTitle),
          imageUrl: croppedImageUrl,
          sourceLabel: `Cropped from ${parentTitle}`,
          dimensions: dimensionsLabel,
        } satisfies ImageNodeData,
      };

      const cropEdge: Edge = {
        id: `edge-crop-${parentNodeId}-${newImageId}-${Date.now()}`,
        source: parentNodeId,
        target: newImageId,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.IMAGE_LEFT_IN,
        type: 'redBezier',
      };

      const nextNodes = [...state.nodes, croppedNode];
      const nextEdges = [...state.edges, cropEdge];
      return {
        nodes: nextNodes,
        edges: nextEdges,
        nodeCounter: index + 1,
        chatContextMap: computeChatContextMap(nextNodes, nextEdges),
      };
    });
    return createdId;
  },

  injectMobileImage: ({ targetId, imageBase64, position, title }) => {
    let outcome: { action: 'created' | 'updated'; nodeId: string } = {
      action: 'created',
      nodeId: '',
    };

    set((state) => {
      const normalizedTargetId =
        typeof targetId === 'string' ? targetId.trim() : '';
      const existingTarget =
        normalizedTargetId && normalizedTargetId !== 'new'
          ? state.nodes.find(
              (node) =>
                node.id === normalizedTargetId && node.data.kind === 'image',
            )
          : undefined;

      if (existingTarget) {
        const nextNodes = state.nodes.map((node) => {
          if (node.id !== existingTarget.id || node.data.kind !== 'image') {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              imageUrl: imageBase64,
              sourceLabel: 'Mobile Sync',
              dimensions: undefined,
            } satisfies ImageNodeData,
          };
        });
        outcome = { action: 'updated', nodeId: existingTarget.id };
        return {
          nodes: nextNodes,
          chatContextMap: computeChatContextMap(nextNodes, state.edges),
        };
      }

      const index = state.nodeCounter;
      const newImageId = `img-${index}`;
      const fallbackPosition = {
        x: 240 + Math.round((Math.random() - 0.5) * 160),
        y: 180 + Math.round((Math.random() - 0.5) * 140),
      };

      const mobileNode: OsintNode = {
        id: newImageId,
        type: 'imageNode',
        position: position ?? fallbackPosition,
        data: {
          kind: 'image',
          title: title?.trim() || 'Mobile Upload',
          imageUrl: imageBase64,
          sourceLabel: 'Mobile Sync',
        } satisfies ImageNodeData,
      };

      const nextNodes = [...state.nodes, mobileNode];
      outcome = { action: 'created', nodeId: newImageId };
      return {
        nodes: nextNodes,
        nodeCounter: index + 1,
        chatContextMap: computeChatContextMap(nextNodes, state.edges),
      };
    });

    return outcome;
  },

  setEnhanceNodeScale: (nodeId, scale) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== 'enhance') return node;
        return {
          ...node,
          data: {
            ...node.data,
            scale,
          } satisfies EnhanceNodeData,
        };
      }),
    }));
  },

  analyzeChatNode: async (chatNodeId, prompt) => {
    const globalSettings = readGlobalSettings();
    const activeProvider = globalSettings.provider;
    const activeApiKey = getGlobalApiKey(activeProvider);

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      set({ alertMessage: 'Enter an analysis prompt before clicking Analyze.' });
      return false;
    }

    const initialState = get();
    const providerMeta = getProviderMeta(activeProvider);
    const resolvedModel =
      globalSettings.model.trim() || providerMeta.defaultModel;

    const contextEntry = initialState.chatContextMap[chatNodeId];
    const hasImages = Boolean(contextEntry && contextEntry.allConnectedImageIds.length > 0);
    const hasEnhanced = Boolean(contextEntry && contextEntry.connectedEnhanceIds.length > 0);
    const hasOcr = Boolean(contextEntry && contextEntry.connectedOcrIds.length > 0);
    const hasExif = Boolean(contextEntry && contextEntry.connectedExifIds.length > 0);

    if (!contextEntry || (!hasImages && !hasEnhanced && !hasOcr && !hasExif)) {
      set({
        alertMessage:
          'No ImageNodes or intelligence sources are connected to this ChatNode. Connect at least one ImageNode, OcrNode, or ExifNode.',
      });
      return false;
    }

    const imageNodesById = new Map<string, ImageNodeData>();
    const ocrNodesById = new Map<string, OcrNodeData>();
    const exifNodesById = new Map<string, ExifNodeData>();
    const enhanceNodesById = new Map<string, EnhanceNodeData>();
    for (const node of initialState.nodes) {
      if (node.data.kind === 'image') {
        imageNodesById.set(node.id, node.data);
      } else if (node.data.kind === 'ocr') {
        ocrNodesById.set(node.id, node.data);
      } else if (node.data.kind === 'exif') {
        exifNodesById.set(node.id, node.data);
      } else if (node.data.kind === 'enhance') {
        enhanceNodesById.set(node.id, node.data);
      }
    }

    const globalImages = contextEntry.globalImageIds
      .map((id) => {
        const data = imageNodesById.get(id);
        return data ? { id, data } : null;
      })
      .filter((item): item is { id: string; data: ImageNodeData } => item !== null);

    const specificImages = contextEntry.specificImageIds
      .map((id) => {
        const data = imageNodesById.get(id);
        return data ? { id, data } : null;
      })
      .filter((item): item is { id: string; data: ImageNodeData } => item !== null);

    const enhancedNodes = contextEntry.connectedEnhanceIds
      .map((id) => {
        const data = enhanceNodesById.get(id);
        return data ? { id, data } : null;
      })
      .filter((item): item is { id: string; data: EnhanceNodeData } => item !== null);

    const ocrContexts: ConnectedOcrPromptContext[] = contextEntry.connectedOcrIds
      .map((id): ConnectedOcrPromptContext | null => {
        const data = ocrNodesById.get(id);
        if (!data) return null;
        return {
          title: data.title,
          sourceTitle: data.sourceTitle ?? null,
          extractedText: data.extractedText ?? '',
          confidence: data.confidence ?? null,
          scope: contextEntry.specificOcrIds.includes(id) ? 'specific' : 'global',
        };
      })
      .filter((item): item is ConnectedOcrPromptContext => item !== null);

    const exifContexts: ConnectedExifPromptContext[] = contextEntry.connectedExifIds
      .map((id): ConnectedExifPromptContext | null => {
        const data = exifNodesById.get(id);
        if (!data) return null;
        return {
          title: data.title,
          sourceTitle: data.sourceTitle ?? null,
          summary: data.summary ?? null,
          scope: contextEntry.specificExifIds.includes(id) ? 'specific' : 'global',
        };
      })
      .filter((item): item is ConnectedExifPromptContext => item !== null);

    // Deduplicate ordered images for inlineData parts while preserving specific target first
    const orderedVisualInputs: Array<{ id: string; title: string; imageUrl: string | null }> = [];
    const seenIds = new Set<string>();
    for (const item of [...specificImages, ...globalImages]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        orderedVisualInputs.push({
          id: item.id,
          title: item.data.title || 'Untitled Image',
          imageUrl: item.data.imageUrl,
        });
      }
    }
    for (const item of enhancedNodes) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        orderedVisualInputs.push({
          id: item.id,
          title: item.data.title || 'Enhanced Frame',
          imageUrl: item.data.enhancedImageUrl ?? null,
        });
      }
    }

    const imagesWithData = orderedVisualInputs.filter((item) => Boolean(item.imageUrl));
    if ((hasImages || hasEnhanced) && imagesWithData.length === 0 && !hasOcr && !hasExif) {
      set({
        alertMessage:
          'Connected ImageNode(s) do not contain an uploaded image yet. Click a placeholder to load an image first.',
      });
      return false;
    }

    set((state) => ({
      alertMessage: null,
      analyzingChatIds: {
        ...state.analyzingChatIds,
        [chatNodeId]: true,
      },
    }));

    const timestamp = formatNowTime();
    const contextNames = [
      ...orderedVisualInputs.map((img) => img.title),
      ...ocrContexts.map((ocr) => ocr.title),
      ...exifContexts.map((exif) => exif.title),
    ];
    const primaryImageUrl = imagesWithData[0]?.imageUrl ?? null;
    const primaryTitle = imagesWithData[0]?.title || 'Connected Frame';

    const summaryParts: string[] = [];
    if (imagesWithData.length > 0) {
      summaryParts.push(
        `${imagesWithData.length} image${imagesWithData.length === 1 ? '' : 's'}`,
      );
    }
    if (ocrContexts.length > 0) {
      summaryParts.push(`${ocrContexts.length} OCR`);
    }
    if (exifContexts.length > 0) {
      summaryParts.push(`${exifContexts.length} EXIF`);
    }
    const sourceSummary =
      summaryParts.length > 0
        ? summaryParts.join(' · ')
        : specificImages.length > 0
          ? 'Specific + Global'
          : 'Global Context';

    try {
      const resolvedParts = await Promise.all(
        imagesWithData.map(async (item) => {
          if (!item.imageUrl) return null;
          return resolveImageToInlinePart(item.imageUrl);
        }),
      );

      const inlineImageParts = resolvedParts.filter(
        (part): part is ParsedInlineImage => part !== null,
      );

      if (inlineImageParts.length === 0 && ocrContexts.length === 0 && exifContexts.length === 0) {
        throw new Error('Could not extract base64 image data from connected ImageNodes.');
      }

      const structuredPrompt = buildOsintPromptText({
        prompt: trimmedPrompt,
        globalTitles: globalImages.map((g) => g.data.title || 'Untitled Image'),
        specificTitles: specificImages.map((s) => s.data.title || 'Untitled Image'),
        enhancedTitles: enhancedNodes.map((e) => e.data.title || 'Enhanced Frame'),
        ocrContexts,
        exifContexts,
      });

      const analysisText = await runMultiProviderAnalysis({
        provider: activeProvider,
        model: resolvedModel,
        apiKey: activeApiKey || undefined,
        promptText: structuredPrompt,
        images: inlineImageParts,
      });

      set((state) => {
        const chatNode = state.nodes.find((n) => n.id === chatNodeId);
        const newResultId = `res-${state.nodeCounter}`;
        const position = chatNode
          ? computeNextResultPosition(chatNode, state.edges, state.nodes)
          : { x: 1140, y: 110 };

        const userMessage: ChatMessage = {
          id: `msg-u-${Date.now()}`,
          role: 'user',
          content: trimmedPrompt,
          timestamp,
          contextSnapshot: contextNames,
        };

        const assistantMessage: ChatMessage = {
          id: `msg-a-${Date.now() + 1}`,
          role: 'assistant',
          content: analysisText,
          timestamp,
        };

        const newResultNode: OsintNode = {
          id: newResultId,
          type: 'resultNode',
          position,
          data: {
            kind: 'result',
            title: `Analysis Output ${state.nodeCounter}`,
            analysisText,
            enhancedImageUrl: primaryImageUrl,
            enhancedCaption: `Reference frame: ${primaryTitle}`,
            sourceSummary,
            updatedAt: timestamp,
            isError: false,
          } satisfies ResultNodeData,
        };

        const newEdge: Edge = {
          id: `edge-${chatNodeId}-${newResultId}-${Date.now()}`,
          source: chatNodeId,
          target: newResultId,
          sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
          targetHandle: HANDLE_IDS.RESULT_IN,
          type: 'redBezier',
        };

        const nextNodes: OsintNode[] = [
          ...state.nodes.map((node) => {
            if (node.id === chatNodeId && node.data.kind === 'chat') {
              return {
                ...node,
                data: {
                  ...node.data,
                  draftPrompt: '',
                  messages: [...node.data.messages, userMessage, assistantMessage],
                } satisfies ChatNodeData,
              };
            }
            return node;
          }),
          newResultNode,
        ];

        const nextEdges = [...state.edges, newEdge];

        return {
          nodes: nextNodes,
          edges: nextEdges,
          nodeCounter: state.nodeCounter + 1,
          chatContextMap: computeChatContextMap(nextNodes, nextEdges),
        };
      });

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unexpected error calling Gemini API.';

      if (isApiAuthError(error)) {
        set({ alertMessage: errorMessage || MISSING_API_KEY_MESSAGE });
        return false;
      }

      set((state) => {
        const chatNode = state.nodes.find((n) => n.id === chatNodeId);
        const newResultId = `res-${state.nodeCounter}`;
        const position = chatNode
          ? computeNextResultPosition(chatNode, state.edges, state.nodes)
          : { x: 1140, y: 110 };

        const userMessage: ChatMessage = {
          id: `msg-u-${Date.now()}`,
          role: 'user',
          content: trimmedPrompt,
          timestamp,
          contextSnapshot: contextNames,
        };

        const errorChatMessage: ChatMessage = {
          id: `msg-e-${Date.now() + 1}`,
          role: 'assistant',
          content: `Analysis failed: ${errorMessage}`,
          timestamp,
        };

        const errorResultNode: OsintNode = {
          id: newResultId,
          type: 'resultNode',
          position,
          data: {
            kind: 'result',
            title: `Analysis Error ${state.nodeCounter}`,
            analysisText: `${providerMeta.name} (${resolvedModel}) Error\n\n${errorMessage}`,
            enhancedImageUrl: primaryImageUrl,
            enhancedCaption: `Reference frame: ${primaryTitle}`,
            sourceSummary: `Error · ${sourceSummary}`,
            updatedAt: timestamp,
            isError: true,
          } satisfies ResultNodeData,
        };

        const newEdge: Edge = {
          id: `edge-${chatNodeId}-${newResultId}-${Date.now()}`,
          source: chatNodeId,
          target: newResultId,
          sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
          targetHandle: HANDLE_IDS.RESULT_IN,
          type: 'redBezier',
        };

        const nextNodes: OsintNode[] = [
          ...state.nodes.map((node) => {
            if (node.id === chatNodeId && node.data.kind === 'chat') {
              return {
                ...node,
                data: {
                  ...node.data,
                  messages: [...node.data.messages, userMessage, errorChatMessage],
                } satisfies ChatNodeData,
              };
            }
            return node;
          }),
          errorResultNode,
        ];

        const nextEdges = [...state.edges, newEdge];

        return {
          nodes: nextNodes,
          edges: nextEdges,
          nodeCounter: state.nodeCounter + 1,
          chatContextMap: computeChatContextMap(nextNodes, nextEdges),
        };
      });

      return false;
    } finally {
      set((state) => ({
        analyzingChatIds: {
          ...state.analyzingChatIds,
          [chatNodeId]: false,
        },
      }));
    }
  },

  generateDorksForNode: async (dorkNodeId) => {
    const initialState = get();
    const dorkNode = initialState.nodes.find((n) => n.id === dorkNodeId);
    if (!dorkNode || dorkNode.data.kind !== 'dork') {
      return { ok: false, error: 'DorkNode not found.' };
    }

    const globalSettings = readGlobalSettings();
    const activeApiKey = getGlobalApiKey(globalSettings.provider);

    const resolvedSource = resolveDorkSourceForNode(
      dorkNodeId,
      initialState.nodes,
      initialState.edges,
    );
    if (!resolvedSource) {
      const msg =
        'Connect an OcrNode, ExifNode, or ChatNode to generate targeted Google Dorks.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }
    if (!resolvedSource.hasText) {
      const msg =
        'Connected source has no extracted text yet. Run OCR, EXIF, or Chat analysis first.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    set((state) => ({
      alertMessage: null,
      generatingDorkIds: {
        ...state.generatingDorkIds,
        [dorkNodeId]: true,
      },
    }));

    try {
      const parsedDorks = await generateGoogleDorks({
        targetType: dorkNode.data.targetType,
        extractedSourceText: resolvedSource.combinedText,
        provider: globalSettings.provider,
        model: globalSettings.model,
        apiKey: activeApiKey || undefined,
      });

      get().updateDorkNodeData(dorkNodeId, {
        dorks: parsedDorks,
        lastSourceSummary: resolvedSource.summaryLabel,
      });

      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to generate Google Dorks.';
      if (isApiAuthError(error)) {
        set({ alertMessage: message || MISSING_API_KEY_MESSAGE });
      }
      return { ok: false, error: message };
    } finally {
      set((state) => ({
        generatingDorkIds: {
          ...state.generatingDorkIds,
          [dorkNodeId]: false,
        },
      }));
    }
  },

  extractGeoIntelCluesForNode: async (geoIntelNodeId) => {
    const initialState = get();
    const geoIntelNode = initialState.nodes.find((n) => n.id === geoIntelNodeId);
    if (!geoIntelNode || geoIntelNode.data.kind !== 'geoIntel') {
      return { ok: false, error: 'GeoIntelNode not found.' };
    }

    const globalSettings = readGlobalSettings();
    const activeProvider = globalSettings.provider;
    const activeApiKey = getGlobalApiKey(activeProvider);

    const connectedImage = getConnectedSourceImageForNode(
      geoIntelNodeId,
      initialState.nodes,
      initialState.edges,
    );
    if (!connectedImage) {
      const msg = 'Connect an ImageNode before extracting geolocation clues.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }
    if (!connectedImage.imageUrl) {
      const msg = 'Connected ImageNode has no image loaded yet.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    const providerMeta = getProviderMeta(activeProvider);
    if (!providerMeta.supportsVision) {
      const msg = `${providerMeta.name} does not support image vision inputs. Select Google, OpenAI, OpenRouter, or Anthropic in Dashboard Settings.`;
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    set((state) => ({
      alertMessage: null,
      extractingGeoIntelIds: {
        ...state.extractingGeoIntelIds,
        [geoIntelNodeId]: true,
      },
    }));

    try {
      const inlinePart = await resolveImageToInlinePart(connectedImage.imageUrl);
      if (!inlinePart) {
        throw new Error('Could not read base64 image data from connected ImageNode.');
      }

      const rawOutput = await runMultiProviderAnalysis({
        provider: activeProvider,
        model: globalSettings.model,
        apiKey: activeApiKey || undefined,
        systemPrompt: GEOINTEL_SYSTEM_PROMPT,
        promptText: buildGeoIntelUserPrompt(connectedImage.title),
        images: [inlinePart],
      });

      const parsedClues = parseGeoIntelCluesResponse(rawOutput);
      if (parsedClues.length === 0) {
        throw new Error('Model returned an empty GEOINT clues list.');
      }

      get().updateGeoIntelNodeData(geoIntelNodeId, {
        clues: parsedClues,
        sourceTitle: connectedImage.title,
      });

      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to extract physical geolocation clues.';
      if (isApiAuthError(error)) {
        set({ alertMessage: message || MISSING_API_KEY_MESSAGE });
      }
      return { ok: false, error: message };
    } finally {
      set((state) => ({
        extractingGeoIntelIds: {
          ...state.extractingGeoIntelIds,
          [geoIntelNodeId]: false,
        },
      }));
    }
  },

  runPivotForNode: async (pivotNodeId) => {
    const initialState = get();
    const pivotNode = initialState.nodes.find((n) => n.id === pivotNodeId);
    if (!pivotNode || pivotNode.data.kind !== 'pivot') {
      return { ok: false, error: 'PivotNode not found.' };
    }

    const resolvedSource = resolvePivotSourceForNode(
      pivotNodeId,
      initialState.nodes,
      initialState.edges,
    );

    const manualCandidate = sanitizeUsernameInput(pivotNode.data.usernameInput);
    const targetUsername =
      manualCandidate || resolvedSource?.suggestedUsername || '';

    if (!targetUsername) {
      const msg = !resolvedSource
        ? 'Enter a target username above or connect an OcrNode / ChatNode.'
        : resolvedSource.hasText
          ? 'Could not isolate a username from connected text. Enter a handle manually above.'
          : 'Connected OcrNode or ChatNode has no text yet. Run extraction or analysis first.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    set((state) => ({
      alertMessage: null,
      pivotingNodeIds: {
        ...state.pivotingNodeIds,
        [pivotNodeId]: true,
      },
    }));

    try {
      const response = await runBackendPivotCheck(targetUsername);
      get().updatePivotNodeData(pivotNodeId, {
        usernameInput: response.username,
        lastCheckedUsername: response.username,
        lastSourceSummary: resolvedSource?.summaryLabel ?? 'Manual input',
        source: response.source,
        results: response.results,
      });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Username pivot lookup failed.';
      return { ok: false, error: message };
    } finally {
      set((state) => ({
        pivotingNodeIds: {
          ...state.pivotingNodeIds,
          [pivotNodeId]: false,
        },
      }));
    }
  },

  runShodanForNode: async (shodanNodeId, overrideApiKey) => {
    const initialState = get();
    const shodanNode = initialState.nodes.find((n) => n.id === shodanNodeId);
    if (!shodanNode || shodanNode.data.kind !== 'shodan') {
      return { ok: false, error: 'ShodanNode not found.' };
    }

    const query = shodanNode.data.queryInput.trim();
    if (!query) {
      const msg = 'Enter an IP address or Shodan search query first.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    const effectiveKey =
      overrideApiKey?.trim() ||
      initialState.shodanApiKey.trim() ||
      getGlobalShodanApiKey();
    if (!effectiveKey) {
      set({ alertMessage: MISSING_SHODAN_KEY_MESSAGE });
      return { ok: false, error: MISSING_SHODAN_KEY_MESSAGE };
    }

    set((state) => ({
      alertMessage: null,
      searchingShodanIds: {
        ...state.searchingShodanIds,
        [shodanNodeId]: true,
      },
    }));

    try {
      const response = await runShodanSearch({
        query,
        apiKey: effectiveKey,
      });
      get().updateShodanNodeData(shodanNodeId, {
        lastQuery: response.query,
        mode: response.mode,
        total: response.total,
        results: response.results,
      });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Shodan host lookup failed.';
      return { ok: false, error: message };
    } finally {
      set((state) => ({
        searchingShodanIds: {
          ...state.searchingShodanIds,
          [shodanNodeId]: false,
        },
      }));
    }
  },

  runArchiveForNode: async (archiveNodeId) => {
    const initialState = get();
    const archiveNode = initialState.nodes.find((n) => n.id === archiveNodeId);
    if (!archiveNode || archiveNode.data.kind !== 'archive') {
      return { ok: false, error: 'ArchiveNode not found.' };
    }

    const resolvedSource = resolveArchiveSourceForNode(
      archiveNodeId,
      initialState.nodes,
      initialState.edges,
    );
    const manualUrl = archiveNode.data.urlInput.trim();
    const targetUrl = manualUrl || resolvedSource?.suggestedUrl || '';

    if (!targetUrl) {
      const msg = !resolvedSource
        ? 'Enter a URL/domain above or connect a ChatNode / OcrNode.'
        : resolvedSource.hasText
          ? 'Could not isolate a URL or domain from connected text. Enter one manually above.'
          : 'Connected ChatNode or OcrNode has no text yet. Run extraction or analysis first.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    set((state) => ({
      alertMessage: null,
      checkingArchiveIds: {
        ...state.checkingArchiveIds,
        [archiveNodeId]: true,
      },
    }));

    try {
      const response = await runArchiveCheck({ url: targetUrl });
      get().updateArchiveNodeData(archiveNodeId, {
        urlInput: response.url,
        lastCheckedUrl: response.url,
        lastSourceSummary: resolvedSource?.summaryLabel ?? 'Direct input',
        snapshots: response.snapshots,
      });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Wayback Machine archive check failed.';
      return { ok: false, error: message };
    } finally {
      set((state) => ({
        checkingArchiveIds: {
          ...state.checkingArchiveIds,
          [archiveNodeId]: false,
        },
      }));
    }
  },

  generateSuspectImageForNode: async (suspectNodeId) => {
    const initialState = get();
    const suspectNode = initialState.nodes.find((n) => n.id === suspectNodeId);
    if (!suspectNode || suspectNode.data.kind !== 'suspect') {
      return { ok: false, error: 'SuspectNode not found.' };
    }

    const globalSettings = readGlobalSettings();
    const activeProvider = globalSettings.provider;
    const activeApiKey = getGlobalApiKey(activeProvider);

    const resolvedContext = resolveSuspectContextForNode(
      suspectNodeId,
      initialState.nodes,
      initialState.edges,
    );
    const description = suspectNode.data.descriptionPrompt.trim();

    if (!description && resolvedContext.items.length === 0) {
      const msg =
        'Enter a Suspect / Target Description or connect an ImageNode, OcrNode, or ChatNode before generating.';
      set({ alertMessage: msg });
      return { ok: false, error: msg };
    }

    set((state) => ({
      alertMessage: null,
      generatingSuspectIds: {
        ...state.generatingSuspectIds,
        [suspectNodeId]: true,
      },
    }));

    try {
      const inlineImages: ParsedInlineImage[] = [];
      for (const imgRef of resolvedContext.imageUrls) {
        const part = await resolveImageToInlinePart(imgRef.imageUrl);
        if (part) inlineImages.push(part);
      }

      const compiledPrompt = buildSuspectCompositePrompt({
        description,
        contextText: resolvedContext.combinedContextText,
      });

      const { imageUrl, modelUsed } = await requestTargetImageGeneration({
        provider: activeProvider,
        apiKey: activeApiKey || undefined,
        prompt: compiledPrompt,
        images: inlineImages,
      });

      const providerMeta = getProviderMeta(activeProvider);
      const providerLabel = `${providerMeta.name} · ${modelUsed}`;

      get().updateSuspectNodeData(suspectNodeId, {
        suspectImageUrl: imageUrl,
        lastCompiledPrompt: compiledPrompt,
        lastSourceSummary: resolvedContext.summaryLabel,
        lastProviderLabel: providerLabel,
      });
      get().setSuspectImageUrl(suspectNodeId, imageUrl);

      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to generate target composite image.';
      if (isApiAuthError(error)) {
        set({ alertMessage: message || MISSING_API_KEY_MESSAGE });
      }
      return { ok: false, error: message };
    } finally {
      set((state) => ({
        generatingSuspectIds: {
          ...state.generatingSuspectIds,
          [suspectNodeId]: false,
        },
      }));
    }
  },
}));

// Synchronize active project nodes/edges into state.projects and debounce IndexedDB + local filesystem saves
useCanvasStore.subscribe((state, prevState) => {
  const graphChanged =
    state.nodes !== prevState.nodes ||
    state.edges !== prevState.edges ||
    state.nodeCounter !== prevState.nodeCounter;

  let latestProjects = state.projects;

  if (graphChanged && state.currentProjectId) {
    const synced = syncActiveProjectInList(
      state.projects,
      state.currentProjectId,
      state.nodes,
      state.edges,
      state.nodeCounter,
    );
    if (synced !== state.projects) {
      latestProjects = synced;
      useCanvasStore.setState({ projects: synced });
    }
  }

  if (!state.isHydrated || suppressAutoSave) return;

  if (
    graphChanged ||
    latestProjects !== prevState.projects ||
    state.currentProjectId !== prevState.currentProjectId
  ) {
    debouncedProjectsSaver.schedule(
      serializeProjectsState({
        projects: latestProjects,
        currentProjectId: state.currentProjectId,
      }),
    );

    if (graphChanged && state.currentProjectId) {
      const activeProject = latestProjects.find(
        (p) => p.id === state.currentProjectId,
      );
      if (activeProject && !activeProject.isSummaryOnly) {
        debouncedServerProjectSaver.schedule(activeProject);
      }
    }
  }
});

