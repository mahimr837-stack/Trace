import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Camera,
  Compass,
  Download,
  FileText,
  Film,
  Globe,
  History,
  MapPin,
  Maximize2,
  MessageSquarePlus,
  Plus,
  Radar,
  ScanFace,
  ScanSearch,
  ScanText,
  Server,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  UserRoundSearch,
  UserSearch,
  Workflow,
  X,
} from 'lucide-react';
import { ImageNode } from './components/nodes/ImageNode';
import { CropNode } from './components/nodes/CropNode';
import { ChatNode } from './components/nodes/ChatNode';
import { ResultNode } from './components/nodes/ResultNode';
import { OcrNode } from './components/nodes/OcrNode';
import { ExifNode } from './components/nodes/ExifNode';
import { EnhanceNode } from './components/nodes/EnhanceNode';
import { MapNode } from './components/nodes/MapNode';
import { ReverseSearchNode } from './components/nodes/ReverseSearchNode';
import { FaceNode } from './components/nodes/FaceNode';
import { VideoNode } from './components/nodes/VideoNode';
import { DorkNode } from './components/nodes/DorkNode';
import { ForensicsNode } from './components/nodes/ForensicsNode';
import { GeoSpyNode } from './components/nodes/GeoSpyNode';
import { GeoIntelNode } from './components/nodes/GeoIntelNode';
import { PivotNode } from './components/nodes/PivotNode';
import { DopplerNode } from './components/nodes/DopplerNode';
import { SuspectNode } from './components/nodes/SuspectNode';
import { ShodanNode } from './components/nodes/ShodanNode';
import { ArchiveNode } from './components/nodes/ArchiveNode';
import { Dashboard } from './components/Dashboard';
import { GlobalSettingsModal } from './components/GlobalSettingsModal';
import { RedBezierEdge } from './components/edges/RedBezierEdge';
import {
  flushCanvasOnVisibilityHidden,
  flushPendingCanvasSave,
  useCanvasStore,
} from './store/useCanvasStore';
import {
  useMobileSync,
  type MobileSyncImagePayload,
} from './hooks/useMobileSync';
import type { DeployableOsintNodeType } from './types/osint';
import {
  buildCaseExportPayload,
  computeDroppedNodePosition,
  hasDraggedNodeType,
  isValidOsintConnection,
  NODE_DRAG_MIME_TYPE,
  readDraggedNodeType,
} from './utils/osintGraph';

const nodeTypes: NodeTypes = {
  imageNode: ImageNode,
  cropNode: CropNode,
  chatNode: ChatNode,
  resultNode: ResultNode,
  ocrNode: OcrNode,
  exifNode: ExifNode,
  enhanceNode: EnhanceNode,
  mapNode: MapNode,
  reverseSearchNode: ReverseSearchNode,
  faceNode: FaceNode,
  videoNode: VideoNode,
  dorkNode: DorkNode,
  forensicsNode: ForensicsNode,
  geoSpyNode: GeoSpyNode,
  geoIntelNode: GeoIntelNode,
  pivotNode: PivotNode,
  dopplerNode: DopplerNode,
  suspectNode: SuspectNode,
  shodanNode: ShodanNode,
  archiveNode: ArchiveNode,
};

const edgeTypes: EdgeTypes = {
  redBezier: RedBezierEdge,
};

const defaultEdgeOptions = {
  type: 'redBezier',
};

const connectionLineStyle = {
  stroke: '#ff4d4d',
  strokeWidth: 2,
};

interface OsintCanvasProps {
  projectId: string | null;
  onBackToDashboard: () => void;
}

function OsintCanvas({ projectId, onBackToDashboard }: OsintCanvasProps) {
  const [draggedNodeType, setDraggedNodeType] = useState<DeployableOsintNodeType | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const projects = useCanvasStore((state) => state.projects);
  const currentProjectId = useCanvasStore((state) => state.currentProjectId);
  const loadProject = useCanvasStore((state) => state.loadProject);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const alertMessage = useCanvasStore((state) => state.alertMessage);
  const clearAlert = useCanvasStore((state) => state.clearAlert);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const onConnect = useCanvasStore((state) => state.onConnect);
  const deployNode = useCanvasStore((state) => state.deployNode);
  const isHydrated = useCanvasStore((state) => state.isHydrated);
  const clearCanvas = useCanvasStore((state) => state.clearCanvas);
  const resetToSampleCanvas = useCanvasStore((state) => state.resetToSampleCanvas);
  const autoLayoutNodes = useCanvasStore((state) => state.autoLayoutNodes);
  const injectMobileImage = useCanvasStore((state) => state.injectMobileImage);

  const { fitView, screenToFlowPosition } = useReactFlow();

  const handleMobileImageReceived = useCallback(
    ({ targetId, imageBase64 }: MobileSyncImagePayload) => {
      const viewportCenter = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const offsetX = Math.round((Math.random() - 0.5) * 180);
      const offsetY = Math.round((Math.random() - 0.5) * 140);

      injectMobileImage({
        targetId,
        imageBase64,
        position: {
          x: Math.round(viewportCenter.x - 128 + offsetX),
          y: Math.round(viewportCenter.y - 110 + offsetY),
        },
        title: 'Mobile Upload',
      });
    },
    [injectMobileImage, screenToFlowPosition],
  );

  const { isConnected: isMobileSyncConnected, syncPin } = useMobileSync({
    onImageReceived: handleMobileImageReceived,
  });

  useEffect(() => {
    if (projectId && projectId !== currentProjectId) {
      loadProject(projectId);
    }
  }, [currentProjectId, loadProject, projectId]);

  const activeProject = useMemo(
    () =>
      projects.find((p) => p.id === (projectId ?? currentProjectId)) ?? null,
    [currentProjectId, projectId, projects],
  );

  const handleIsValidConnection = useCallback(
    (connection: Connection) => isValidOsintConnection(connection, nodes),
    [nodes],
  );

  const handleToolbarNodeDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, nodeType: DeployableOsintNodeType) => {
      setDraggedNodeType(nodeType);
      event.dataTransfer.setData(NODE_DRAG_MIME_TYPE, nodeType);
      event.dataTransfer.setData('text/plain', nodeType);
      event.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const handleToolbarNodeDragEnd = useCallback(() => {
    setDraggedNodeType(null);
    setIsDropActive(false);
  }, []);

  const handleCanvasDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedNodeType === null && !hasDraggedNodeType(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!isDropActive) {
        setIsDropActive(true);
      }
    },
    [draggedNodeType, isDropActive],
  );

  const handleCanvasDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDropActive(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const nodeType = readDraggedNodeType(event.dataTransfer) ?? draggedNodeType;
      setDraggedNodeType(null);
      setIsDropActive(false);
      if (!nodeType) return;

      event.preventDefault();
      const flowPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      deployNode(nodeType, computeDroppedNodePosition(flowPosition));
    },
    [deployNode, draggedNodeType, screenToFlowPosition],
  );

  const handleExportCase = useCallback(() => {
    const payload = buildCaseExportPayload(nodes, edges);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'osint_case.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [edges, nodes]);

  const handleClearCanvas = useCallback(() => {
    void clearCanvas();
  }, [clearCanvas]);

  const handleAutoLayout = useCallback(() => {
    autoLayoutNodes('LR');
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.22, duration: 280 });
    });
  }, [autoLayoutNodes, fitView]);

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  return (
    <main
      className={`relative h-screen w-screen bg-[#f5f5f5] transition-shadow ${
        isDropActive ? 'ring-2 ring-inset ring-[#ff4d4d]/40' : ''
      }`}
      data-testid="osint-canvas-root"
      data-hydrated={isHydrated ? 'true' : 'false'}
      data-drop-active={isDropActive ? 'true' : 'false'}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={handleCanvasDragOver}
        onDragLeave={handleCanvasDragLeave}
        onDrop={handleCanvasDrop}
        isValidConnection={handleIsValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={connectionLineStyle}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 0.94 }}
        minZoom={0.25}
        maxZoom={2}
        proOptions={proOptions}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.25}
          color="#d4d4d4"
        />

        {/* Top-left floating toolbar with Back to Dashboard, Add Image Node, OSINT tools, and Models button */}
        <Panel position="top-left" className="!m-4 flex flex-col items-start gap-2.5">
          <div
            data-testid="main-toolbar"
            className="flex flex-wrap items-center gap-0.5 rounded-xl border border-neutral-200/90 bg-white/95 p-1 shadow-sm backdrop-blur-xs"
          >
            <button
              type="button"
              onClick={onBackToDashboard}
              aria-label="Back to Projects Dashboard"
              data-testid="back-to-dashboard-btn"
              title="Return to Projects Dashboard"
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Projects</span>
            </button>

            {activeProject && (
              <span
                data-testid="active-project-badge"
                title={activeProject.name}
                className="max-w-[140px] truncate rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-800 shrink-0"
              >
                {activeProject.name}
              </span>
            )}

            <div className="mx-0.5 h-5 w-px bg-neutral-200 hidden sm:block" aria-hidden="true" />

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'imageNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('imageNode')}
              aria-label="Add Image Node"
              data-testid="add-image-node-btn"
              data-node-type="imageNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg bg-neutral-900 px-2 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-neutral-800 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">Image</span>
            </button>

            <div className="mx-0.5 h-5 w-px bg-neutral-200 hidden sm:block" aria-hidden="true" />

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'chatNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('chatNode')}
              aria-label="Add Chat Node"
              data-testid="add-chat-node-btn"
              data-node-type="chatNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <MessageSquarePlus className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">Chat</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'resultNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('resultNode')}
              aria-label="Add Result Node"
              data-testid="add-result-node-btn"
              data-node-type="resultNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <FileText className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">Result</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'ocrNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('ocrNode')}
              aria-label="Add OCR Node"
              data-testid="add-ocr-node-btn"
              data-node-type="ocrNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <ScanText className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">OCR</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'exifNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('exifNode')}
              aria-label="Add EXIF Node"
              data-testid="add-exif-node-btn"
              data-node-type="exifNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Camera className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">EXIF</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'enhanceNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('enhanceNode')}
              aria-label="Add Enhance Node"
              data-testid="add-enhance-node-btn"
              data-node-type="enhanceNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">Enhance</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'mapNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('mapNode')}
              aria-label="Add Map Node"
              data-testid="add-map-node-btn"
              data-node-type="mapNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <MapPin className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Map</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'reverseSearchNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('reverseSearchNode')}
              aria-label="Add Reverse Search Node"
              data-testid="add-reverse-search-node-btn"
              data-node-type="reverseSearchNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Globe className="h-3 w-3 pointer-events-none" />
              <span className="pointer-events-none">RevSearch</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'faceNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('faceNode')}
              aria-label="Add Face Node"
              data-testid="add-face-node-btn"
              data-node-type="faceNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <ScanFace className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Face</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'videoNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('videoNode')}
              aria-label="Add Video Node"
              data-testid="add-video-node-btn"
              data-node-type="videoNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Film className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Video</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'dorkNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('dorkNode')}
              aria-label="Add Dork Node"
              data-testid="add-dork-node-btn"
              data-node-type="dorkNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Terminal className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Dork</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'forensicsNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('forensicsNode')}
              aria-label="Add Forensics Node"
              data-testid="add-forensics-node-btn"
              data-node-type="forensicsNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <ScanSearch className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Forensics</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'geoSpyNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('geoSpyNode')}
              aria-label="Add GeoSpy Node"
              data-testid="add-geospy-node-btn"
              data-node-type="geoSpyNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Compass className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">GeoSpy</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'geoIntelNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('geoIntelNode')}
              aria-label="Add GeoIntel Node"
              data-testid="add-geointel-node-btn"
              data-node-type="geoIntelNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Radar className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">GeoIntel</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'pivotNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('pivotNode')}
              aria-label="Add Pivot Node"
              data-testid="add-pivot-node-btn"
              data-node-type="pivotNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <UserSearch className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Pivot</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'dopplerNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('dopplerNode')}
              aria-label="Add Doppler Node"
              data-testid="add-doppler-node-btn"
              data-node-type="dopplerNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Activity className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Doppler</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'suspectNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('suspectNode')}
              aria-label="Add Suspect Node"
              data-testid="add-suspect-node-btn"
              data-node-type="suspectNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <UserRoundSearch className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Suspect</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'shodanNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('shodanNode')}
              aria-label="Add Shodan Node"
              data-testid="add-shodan-node-btn"
              data-node-type="shodanNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Server className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Shodan</span>
            </button>

            <button
              type="button"
              draggable
              onDragStart={(e) => handleToolbarNodeDragStart(e, 'archiveNode')}
              onDragEnd={handleToolbarNodeDragEnd}
              onClick={() => deployNode('archiveNode')}
              aria-label="Add Archive Node"
              data-testid="add-archive-node-btn"
              data-node-type="archiveNode"
              title="Click to add or drag onto canvas"
              className="inline-flex cursor-grab select-none items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <History className="h-3 w-3 text-[#ff4d4d] pointer-events-none" />
              <span className="pointer-events-none">Archive</span>
            </button>

            <button
              type="button"
              onClick={() => fitView({ padding: 0.22, duration: 280 })}
              aria-label="Fit canvas to nodes"
              title="Fit canvas to nodes"
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Maximize2 className="h-3 w-3" />
            </button>

            <div className="mx-0.5 h-5 w-px bg-neutral-200 hidden sm:block" aria-hidden="true" />

            <button
              type="button"
              onClick={handleAutoLayout}
              aria-label="Auto-Layout"
              data-testid="auto-layout-btn"
              title="Organize canvas nodes by connection hierarchy (DAG)"
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Workflow className="h-3 w-3 text-[#ff4d4d]" />
              <span>Auto-Layout</span>
            </button>

            <button
              type="button"
              onClick={handleExportCase}
              aria-label="Export Case"
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 whitespace-nowrap shrink-0"
            >
              <Download className="h-3 w-3" />
              <span>Export</span>
            </button>

            <button
              type="button"
              onClick={handleClearCanvas}
              aria-label="Clear Canvas"
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:border-red-200 hover:bg-red-50/70 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3 w-3" />
              <span>Clear</span>
            </button>

            <div className="mx-0.5 h-5 w-px bg-neutral-200 hidden sm:block" aria-hidden="true" />

            {/* Mobile Companion WebSocket Sync Status Indicator */}
            <div
              data-testid="ws-sync-indicator"
              data-status={isMobileSyncConnected ? 'connected' : 'disconnected'}
              title={
                isMobileSyncConnected
                  ? `Mobile sync connected (/sync${syncPin ? ` · PIN: ${syncPin}` : ''})`
                  : 'Mobile sync disconnected (/sync)'
              }
              aria-label={
                isMobileSyncConnected
                  ? 'Mobile sync connected'
                  : 'Mobile sync disconnected'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-600 whitespace-nowrap shrink-0"
            >
              <span
                data-testid="ws-sync-dot"
                className={`h-2 w-2 rounded-full transition-colors ${
                  isMobileSyncConnected ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                aria-hidden="true"
              />
              <span>Sync</span>
            </div>
          </div>

          {/* Non-blocking accessible alert banner */}
          {alertMessage && (
            <div
              role="alert"
              data-testid="canvas-alert"
              className="flex max-w-xl items-center justify-between gap-3 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-xs text-red-700 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                <span>{alertMessage}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {(alertMessage.toLowerCase().includes('api key') ||
                  alertMessage.toLowerCase().includes('settings')) && (
                  <button
                    type="button"
                    data-testid="alert-open-settings-btn"
                    onClick={() => {
                      clearAlert();
                      setIsSettingsOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
                  >
                    <Settings className="h-3 w-3" aria-hidden="true" />
                    <span>Open Settings</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearAlert}
                  aria-label="Dismiss alert"
                  className="rounded p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </Panel>

        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => {
            if (node.type === 'chatNode') return '#ff4d4d';
            if (node.type === 'cropNode') return '#fb7185';
            if (node.type === 'resultNode') return '#171717';
            if (
              node.type === 'ocrNode' ||
              node.type === 'exifNode' ||
              node.type === 'enhanceNode' ||
              node.type === 'mapNode' ||
              node.type === 'reverseSearchNode' ||
              node.type === 'faceNode' ||
              node.type === 'videoNode' ||
              node.type === 'dorkNode' ||
              node.type === 'forensicsNode' ||
              node.type === 'geoSpyNode' ||
              node.type === 'geoIntelNode' ||
              node.type === 'pivotNode' ||
              node.type === 'dopplerNode' ||
              node.type === 'shodanNode' ||
              node.type === 'archiveNode'
            ) {
              return '#525252';
            }
            return '#a3a3a3';
          }}
          maskColor="rgba(245, 245, 245, 0.72)"
        />
      </ReactFlow>

      {isHydrated && nodes.length === 0 && (
        <div
          data-testid="empty-canvas-state"
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
        >
          <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-xl border border-neutral-200/90 bg-white/95 px-5 py-4 text-center shadow-xs">
            <p className="text-xs font-medium text-neutral-700">
              Canvas cleared. Add an Image, Chat, or OSINT tool node from the toolbar.
            </p>
            <button
              type="button"
              onClick={resetToSampleCanvas}
              className="text-xs font-medium text-neutral-500 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Restore Sample Case
            </button>
          </div>
        </div>
      )}

      <GlobalSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </main>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'canvas'>('dashboard');
  const [projectId, setProjectId] = useState<string | null>(null);

  const currentProjectId = useCanvasStore((state) => state.currentProjectId);
  const hydrateFromIndexedDb = useCanvasStore((state) => state.hydrateFromIndexedDb);

  useEffect(() => {
    void hydrateFromIndexedDb();
  }, [hydrateFromIndexedDb]);

  useEffect(() => {
    const handleUnloadFlush = () => {
      flushPendingCanvasSave();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCanvasOnVisibilityHidden();
      }
    };
    window.addEventListener('beforeunload', handleUnloadFlush);
    window.addEventListener('pagehide', handleUnloadFlush);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleUnloadFlush);
      window.removeEventListener('pagehide', handleUnloadFlush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleSelectProject = useCallback((selectedProjectId: string) => {
    setProjectId(selectedProjectId);
    setCurrentView('canvas');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    flushCanvasOnVisibilityHidden();
    setCurrentView('dashboard');
  }, []);

  if (currentView === 'dashboard') {
    return <Dashboard onSelectProject={handleSelectProject} />;
  }

  return (
    <ReactFlowProvider>
      <OsintCanvas
        projectId={projectId ?? currentProjectId}
        onBackToDashboard={handleBackToDashboard}
      />
    </ReactFlowProvider>
  );
}
