import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge } from 'reactflow';
import type { OsintNode } from '../types/osint';
import type { ExpandedTags } from 'exifreader';
import {
  buildCaseExportPayload,
  buildOsintPromptText,
  computeChatContextMap,
  computeDroppedNodePosition,
  computeNextResultPosition,
  computeSpawnedCropNodePosition,
  computeSpawnedCroppedImagePosition,
  computeSpawnedImageFromVideoPosition,
  createOsintNode,
  DEPLOYABLE_NODE_TYPES,
  formatExifSummary,
  generateOsintAnalysis,
  getConnectedResultNodeIds,
  getConnectedSourceImageForNode,
  HANDLE_IDS,
  hasDraggedNodeType,
  isDeployableOsintNodeType,
  isValidOsintConnection,
  NODE_DRAG_MIME_TYPE,
  parseBase64DataUrl,
  readDraggedNodeType,
  resolveDorkSourceForNode,
  resolveMapSourceForNode,
  resolvePivotSourceForNode,
} from './osintGraph';

function makeImageNode(id: string, title: string, imageUrl: string | null = '/test.jpg'): OsintNode {
  return {
    id,
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'image',
      title,
      imageUrl,
    },
  };
}

function makeChatNode(id: string): OsintNode {
  return {
    id,
    type: 'chatNode',
    position: { x: 400, y: 0 },
    data: {
      kind: 'chat',
      title: 'OSINT Thread',
      messages: [],
    },
  };
}

function makeResultNode(id: string): OsintNode {
  return {
    id,
    type: 'resultNode',
    position: { x: 800, y: 0 },
    data: {
      kind: 'result',
      title: 'Result',
      analysisText: '',
      enhancedImageUrl: null,
      enhancedCaption: '',
      sourceSummary: '',
      updatedAt: '',
    },
  };
}

test('tracks direct global and specific ImageNode connections to ChatNode', () => {
  const nodes: OsintNode[] = [
    makeImageNode('img-1', 'Port Aerial'),
    makeImageNode('img-2', 'Container Crop'),
    makeChatNode('chat-1'),
  ];

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'img-1',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
    {
      id: 'e2',
      source: 'img-2',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
    },
  ];

  const contextMap = computeChatContextMap(nodes, edges);
  assert.deepEqual(contextMap['chat-1'].globalImageIds, ['img-1']);
  assert.deepEqual(contextMap['chat-1'].specificImageIds, ['img-2']);
  assert.deepEqual(contextMap['chat-1'].allConnectedImageIds, ['img-1', 'img-2']);
  assert.equal(contextMap['chat-1'].hasActiveContext, true);
});

test('resolves grouped ImageNodes connected top-to-bottom when wired to ChatNode', () => {
  const nodes: OsintNode[] = [
    makeImageNode('img-1', 'Wide Shot'),
    makeImageNode('img-2', 'Street Sign'),
    makeImageNode('img-3', 'Unconnected Frame'),
    makeChatNode('chat-1'),
  ];

  const edges: Edge[] = [
    {
      id: 'group-1-2',
      source: 'img-1',
      target: 'img-2',
      sourceHandle: HANDLE_IDS.IMAGE_GROUP_OUT,
      targetHandle: HANDLE_IDS.IMAGE_GROUP_IN,
    },
    {
      id: 'wire-2-chat',
      source: 'img-2',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
  ];

  const contextMap = computeChatContextMap(nodes, edges);
  assert.equal(contextMap['chat-1'].hasActiveContext, true);
  assert.deepEqual(
    contextMap['chat-1'].globalImageIds.slice().sort(),
    ['img-1', 'img-2'],
  );
  assert.equal(contextMap['chat-1'].allConnectedImageIds.includes('img-3'), false);
});

test('clears active context when edges are disconnected', () => {
  const nodes: OsintNode[] = [makeImageNode('img-1', 'Port'), makeChatNode('chat-1')];
  const contextMap = computeChatContextMap(nodes, []);
  assert.equal(contextMap['chat-1'].hasActiveContext, false);
  assert.deepEqual(contextMap['chat-1'].allConnectedImageIds, []);
});

test('validates allowed OSINT handle connections and rejects invalid ones', () => {
  const nodes: OsintNode[] = [
    makeImageNode('img-1', 'A'),
    makeImageNode('img-2', 'B'),
    makeChatNode('chat-1'),
    makeResultNode('res-1'),
  ];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'chat-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'img-2',
        sourceHandle: HANDLE_IDS.IMAGE_GROUP_OUT,
        targetHandle: HANDLE_IDS.IMAGE_GROUP_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: 'res-1',
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.RESULT_IN,
      },
      nodes,
    ),
    true,
  );

  // Reject self-connection
  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'img-1',
        sourceHandle: HANDLE_IDS.IMAGE_GROUP_OUT,
        targetHandle: HANDLE_IDS.IMAGE_GROUP_IN,
      },
      nodes,
    ),
    false,
  );

  // Reject ResultNode -> ImageNode backwards wiring
  assert.equal(
    isValidOsintConnection(
      {
        source: 'res-1',
        target: 'img-1',
        sourceHandle: null,
        targetHandle: null,
      },
      nodes,
    ),
    false,
  );
});

test('finds connected ResultNodes and generates grounded OSINT analysis', () => {
  const nodes: OsintNode[] = [
    makeImageNode('img-1', 'Port Terminal Aerial', '/port.jpg'),
    makeChatNode('chat-1'),
    makeResultNode('res-1'),
  ];

  const edges: Edge[] = [
    {
      id: 'chat-to-res',
      source: 'chat-1',
      target: 'res-1',
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.RESULT_IN,
    },
  ];

  assert.deepEqual(getConnectedResultNodeIds('chat-1', edges, nodes), ['res-1']);

  const output = generateOsintAnalysis({
    prompt: 'Estimate shadow azimuth and crane alignment',
    globalImages: [{ id: 'img-1', data: { kind: 'image', title: 'Port Terminal Aerial', imageUrl: '/port.jpg' } }],
    specificImages: [],
    fallbackEnhancedUrl: '/enhanced.jpg',
  });

  assert.match(output.replyText, /Port Terminal Aerial/);
  assert.match(output.analysisText, /Solar azimuth/);
  assert.equal(output.enhancedImageUrl, '/port.jpg');
});

test('parses base64 data URLs into inlineData mimeType and raw base64 payload', () => {
  const parsed = parseBase64DataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  assert.deepEqual(parsed, {
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUg==',
  });
  assert.equal(parseBase64DataUrl('/src/assets/images/sample.jpg'), null);
  assert.equal(parseBase64DataUrl(''), null);
});

test('builds structured OSINT prompt text with Global and Specific context sections', () => {
  const promptText = buildOsintPromptText({
    prompt: 'Identify the container prefix',
    globalTitles: ['Port Terminal Aerial'],
    specificTitles: ['Container ISO Detail'],
  });
  assert.match(promptText, /Global Context frames \(1\): Port Terminal Aerial/);
  assert.match(promptText, /Specific Context target frames \(1\): Container ISO Detail/);
  assert.match(promptText, /Analyst Question: Identify the container prefix/);
});

test('staggers newly created ResultNode positions vertically when a ChatNode already has outputs', () => {
  const chat = makeChatNode('chat-1');
  const res1 = makeResultNode('res-1');
  const edges: Edge[] = [
    {
      id: 'e-out-1',
      source: 'chat-1',
      target: 'res-1',
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.RESULT_IN,
    },
  ];

  const pos0 = computeNextResultPosition(chat, [], [chat]);
  assert.deepEqual(pos0, { x: 870, y: 0 });

  const pos1 = computeNextResultPosition(chat, edges, [chat, res1]);
  assert.deepEqual(pos1, { x: 870, y: 560 });
});

test('validates ImageNode connections to OcrNode and ExifNode and resolves source image', () => {
  const img = makeImageNode('img-1', 'Street Sign', 'data:image/png;base64,abc');
  const ocr: OsintNode = {
    id: 'ocr-1',
    type: 'ocrNode',
    position: { x: 400, y: 0 },
    data: { kind: 'ocr', title: 'OCR Text' },
  };
  const exif: OsintNode = {
    id: 'exif-1',
    type: 'exifNode',
    position: { x: 400, y: 300 },
    data: { kind: 'exif', title: 'EXIF Metadata' },
  };

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'ocr-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.OCR_IN,
      },
      [img, ocr, exif],
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'exif-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.EXIF_IN,
      },
      [img, ocr, exif],
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'ocr-1',
        target: 'img-1',
        sourceHandle: null,
        targetHandle: null,
      },
      [img, ocr, exif],
    ),
    false,
  );

  const edges: Edge[] = [
    {
      id: 'e-ocr',
      source: 'img-1',
      target: 'ocr-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.OCR_IN,
    },
  ];

  const resolved = getConnectedSourceImageForNode('ocr-1', [img, ocr, exif], edges);
  assert.deepEqual(resolved, {
    id: 'img-1',
    title: 'Street Sign',
    imageUrl: 'data:image/png;base64,abc',
    sourceLabel: undefined,
  });

  // Disconnected node returns null
  assert.equal(getConnectedSourceImageForNode('exif-1', [img, ocr, exif], edges), null);
});

test('formats EXIF camera make/model, date taken, GPS coordinates, and stripped fallbacks', () => {
  const fullTags = {
    file: {
      FileType: { value: 'jpeg', description: 'JPEG' },
      'Image Width': { value: 4032, description: '4032px' },
      'Image Height': { value: 3024, description: '3024px' },
    },
    exif: {
      Make: { id: 271, value: ['Apple'], description: 'Apple' },
      Model: { id: 272, value: ['iPhone 15 Pro'], description: 'iPhone 15 Pro' },
      DateTimeOriginal: {
        id: 36867,
        value: ['2026:05:12 14:22:10'],
        description: '2026:05:12 14:22:10',
      },
    },
    gps: {
      Latitude: 48.8566142,
      Longitude: 2.3522219,
    },
  } as unknown as ExpandedTags;

  assert.deepEqual(formatExifSummary(fullTags), {
    camera: 'Apple iPhone 15 Pro',
    dateTaken: '2026:05:12 14:22:10',
    gpsCoordinates: '48.856614, 2.352222',
    hasGps: true,
    dimensions: '4032 × 3024',
    fileType: 'JPEG',
  });

  const strippedTags = {
    file: {
      FileType: { value: 'png', description: 'PNG' },
    },
  } as unknown as ExpandedTags;

  assert.deepEqual(formatExifSummary(strippedTags), {
    camera: 'Not present',
    dateTaken: 'Not present',
    gpsCoordinates: 'No GPS tags',
    hasGps: false,
    dimensions: 'Unknown',
    fileType: 'PNG',
  });
});

test('allows ImageNode -> EnhanceNode and OCR/EXIF -> ChatNode connections and tracks context map', () => {
  const img = makeImageNode('img-1', 'Container Crop', 'data:image/png;base64,abc');
  const enhance: OsintNode = {
    id: 'enh-1',
    type: 'enhanceNode',
    position: { x: 300, y: 200 },
    data: {
      kind: 'enhance',
      title: 'Super-Resolution 4',
      scale: 2,
      enhancedImageUrl: 'data:image/png;base64,upscaled',
      sourceTitle: 'Container Crop',
    },
  };
  const ocr: OsintNode = {
    id: 'ocr-1',
    type: 'ocrNode',
    position: { x: 300, y: 400 },
    data: {
      kind: 'ocr',
      title: 'OCR Extractor 5',
      extractedText: 'MSCU 493026 0',
      confidence: 88,
      sourceTitle: 'Container Crop',
    },
  };
  const exif: OsintNode = {
    id: 'exif-1',
    type: 'exifNode',
    position: { x: 300, y: 600 },
    data: {
      kind: 'exif',
      title: 'EXIF Inspector 6',
      sourceTitle: 'Container Crop',
      summary: {
        camera: 'Sony ILCE-7M4',
        dateTaken: '2026:04:01 11:20:00',
        gpsCoordinates: '51.924420, 4.477733',
        hasGps: true,
        dimensions: '2048 × 1536',
        fileType: 'JPEG',
      },
    },
  };
  const chat = makeChatNode('chat-1');
  const allNodes = [img, enhance, ocr, exif, chat];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'enh-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.ENHANCE_IN,
      },
      allNodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'ocr-1',
        target: 'chat-1',
        sourceHandle: HANDLE_IDS.OCR_OUT,
        targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
      },
      allNodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'exif-1',
        target: 'chat-1',
        sourceHandle: HANDLE_IDS.EXIF_OUT,
        targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
      },
      allNodes,
    ),
    true,
  );

  // EnhanceNode can also feed downstream to OCR/Chat
  assert.equal(
    isValidOsintConnection(
      {
        source: 'enh-1',
        target: 'ocr-1',
        sourceHandle: HANDLE_IDS.ENHANCE_OUT,
        targetHandle: HANDLE_IDS.OCR_IN,
      },
      allNodes,
    ),
    true,
  );

  const edges: Edge[] = [
    {
      id: 'e-ocr-chat',
      source: 'ocr-1',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
    },
    {
      id: 'e-exif-chat',
      source: 'exif-1',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.EXIF_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
    {
      id: 'e-enh-ocr',
      source: 'enh-1',
      target: 'ocr-1',
      sourceHandle: HANDLE_IDS.ENHANCE_OUT,
      targetHandle: HANDLE_IDS.OCR_IN,
    },
  ];

  const contextMap = computeChatContextMap(allNodes, edges);
  assert.deepEqual(contextMap['chat-1'].connectedOcrIds, ['ocr-1']);
  assert.deepEqual(contextMap['chat-1'].connectedExifIds, ['exif-1']);
  assert.equal(contextMap['chat-1'].hasActiveContext, true);

  const resolvedOcrInput = getConnectedSourceImageForNode('ocr-1', allNodes, edges);
  assert.equal(resolvedOcrInput?.imageUrl, 'data:image/png;base64,upscaled');
});

test('injects connected OCR text and EXIF GPS/metadata into buildOsintPromptText', () => {
  const promptText = buildOsintPromptText({
    prompt: 'Correlate the stencil code with camera coordinates.',
    globalTitles: ['Port Terminal Aerial'],
    specificTitles: [],
    ocrContexts: [
      {
        title: 'OCR Extractor 5',
        sourceTitle: 'Container Crop',
        extractedText: 'MSCU 493026 0',
        confidence: 88,
      },
    ],
    exifContexts: [
      {
        title: 'EXIF Inspector 6',
        sourceTitle: 'Street Frame',
        summary: {
          camera: 'Apple iPhone 15 Pro',
          dateTaken: '2026:05:12 14:22:10',
          gpsCoordinates: '51.924420, 4.477733',
          hasGps: true,
          dimensions: '4032 × 3024',
          fileType: 'JPEG',
        },
      },
    ],
  });

  assert.match(promptText, /Injected OCR Text Context:/);
  assert.match(promptText, /MSCU 493026 0/);
  assert.match(promptText, /Injected EXIF Metadata & GPS Context:/);
  assert.match(promptText, /51\.924420, 4\.477733/);
  assert.match(promptText, /Apple iPhone 15 Pro/);
});

test('builds complete osint_case.json export payload with nodes, connections, OCR, EXIF, and AI responses', () => {
  const nodes: OsintNode[] = [
    makeImageNode('img-1', 'Port Aerial'),
    {
      id: 'ocr-1',
      type: 'ocrNode',
      position: { x: 200, y: 100 },
      data: {
        kind: 'ocr',
        title: 'OCR 1',
        extractedText: 'MAEU 123456 7',
        confidence: 91,
        sourceTitle: 'Port Aerial',
      },
    },
    {
      id: 'exif-1',
      type: 'exifNode',
      position: { x: 200, y: 300 },
      data: {
        kind: 'exif',
        title: 'EXIF 1',
        sourceTitle: 'Port Aerial',
        summary: {
          camera: 'DJI Mavic 3',
          dateTaken: '2026:06:01 10:00:00',
          gpsCoordinates: '33.740500, -118.272000',
          hasGps: true,
          dimensions: '5280 × 3956',
          fileType: 'JPEG',
        },
      },
    },
    {
      id: 'chat-1',
      type: 'chatNode',
      position: { x: 500, y: 100 },
      data: {
        kind: 'chat',
        title: 'Inquiry',
        messages: [
          { id: 'm1', role: 'user', content: 'Where is this?', timestamp: '10:01' },
          { id: 'm2', role: 'assistant', content: 'San Pedro Bay terminal.', timestamp: '10:01' },
        ],
      },
    },
    {
      id: 'res-1',
      type: 'resultNode',
      position: { x: 900, y: 100 },
      data: {
        kind: 'result',
        title: 'Report 1',
        analysisText: 'Confirmed container MAEU 123456 7 at Port of Los Angeles.',
        enhancedImageUrl: null,
        enhancedCaption: '',
        sourceSummary: '1 image · 1 OCR · 1 EXIF',
        updatedAt: '10:01',
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'ocr-1',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
      type: 'redBezier',
    },
  ];

  const payload = buildCaseExportPayload(nodes, edges, '2026-11-15T21:00:00.000Z');
  assert.equal(payload.exportedAt, '2026-11-15T21:00:00.000Z');
  assert.equal(payload.summary.nodeCount, 5);
  assert.equal(payload.summary.connectionCount, 1);
  assert.equal(payload.extractedText[0]?.text, 'MAEU 123456 7');
  assert.equal(payload.exifData[0]?.metadata?.camera, 'DJI Mavic 3');
  assert.equal(payload.aiResponses.length, 2);
  assert.equal(payload.aiResponses[0]?.responses[0], 'San Pedro Bay terminal.');
  assert.equal(
    payload.aiResponses[1]?.responses[0],
    'Confirmed container MAEU 123456 7 at Port of Los Angeles.',
  );
});

test('validates ExifNode and ChatNode connections to MapNode and rejects ImageNode -> MapNode', () => {
  const img = makeImageNode('img-1', 'Harbor Frame');
  const chat = makeChatNode('chat-1');
  const exif: OsintNode = {
    id: 'exif-1',
    type: 'exifNode',
    position: { x: 200, y: 200 },
    data: {
      kind: 'exif',
      title: 'EXIF 1',
      summary: null,
      sourceTitle: null,
    },
  };
  const mapNode: OsintNode = {
    id: 'map-1',
    type: 'mapNode',
    position: { x: 700, y: 200 },
    data: {
      kind: 'map',
      title: 'Geolocation Map 1',
    },
  };
  const nodes = [img, chat, exif, mapNode];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'exif-1',
        target: 'map-1',
        sourceHandle: HANDLE_IDS.EXIF_OUT,
        targetHandle: HANDLE_IDS.MAP_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: 'map-1',
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.MAP_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'map-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.MAP_IN,
      },
      nodes,
    ),
    false,
  );
});

test('resolveMapSourceForNode extracts GPS coordinates from ExifNode and text coordinates from ChatNode', () => {
  const exif: OsintNode = {
    id: 'exif-1',
    type: 'exifNode',
    position: { x: 200, y: 200 },
    data: {
      kind: 'exif',
      title: 'EXIF Inspector',
      sourceTitle: 'Port Aerial',
      summary: {
        camera: 'DJI Mavic 3',
        dateTaken: '2026:06:01 10:00:00',
        gpsCoordinates: '33.740500, -118.272000',
        hasGps: true,
        dimensions: '5280 × 3956',
        fileType: 'JPEG',
      },
    },
  };
  const chat: OsintNode = {
    id: 'chat-1',
    type: 'chatNode',
    position: { x: 400, y: 0 },
    data: {
      kind: 'chat',
      title: 'OSINT Thread',
      messages: [
        { id: 'm1', role: 'user', content: 'Geolocate this junction.', timestamp: '10:00' },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Cross-referenced signage places this intersection near 34.0522, -118.2437 in Los Angeles.',
          timestamp: '10:01',
        },
      ],
    },
  };
  const mapNode: OsintNode = {
    id: 'map-1',
    type: 'mapNode',
    position: { x: 700, y: 200 },
    data: {
      kind: 'map',
      title: 'Geolocation Map',
    },
  };

  // Disconnected
  assert.equal(resolveMapSourceForNode('map-1', [exif, chat, mapNode], []), null);

  // Connected from ExifNode
  const exifResolved = resolveMapSourceForNode(
    'map-1',
    [exif, chat, mapNode],
    [
      {
        id: 'e-exif-map',
        source: 'exif-1',
        target: 'map-1',
        sourceHandle: HANDLE_IDS.EXIF_OUT,
        targetHandle: HANDLE_IDS.MAP_IN,
      },
    ],
  );
  assert.equal(exifResolved?.sourceType, 'exif');
  assert.deepEqual(exifResolved?.coordinates, { lat: 33.7405, lng: -118.272 });

  // Connected from ChatNode
  const chatResolved = resolveMapSourceForNode(
    'map-1',
    [exif, chat, mapNode],
    [
      {
        id: 'e-chat-map',
        source: 'chat-1',
        target: 'map-1',
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.MAP_IN,
      },
    ],
  );
  assert.equal(chatResolved?.sourceType, 'chat');
  assert.deepEqual(chatResolved?.coordinates, { lat: 34.0522, lng: -118.2437 });
});

test('validates ImageNode -> ReverseSearchNode connections and rejects invalid sources', () => {
  const img = makeImageNode('img-1', 'Street Frame', 'data:image/png;base64,abc');
  const chat = makeChatNode('chat-1');
  const reverseSearch: OsintNode = {
    id: 'rev-1',
    type: 'reverseSearchNode',
    position: { x: 600, y: 200 },
    data: {
      kind: 'reverseSearch',
      title: 'Reverse Image Search 1',
    },
  };

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'rev-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.REVERSE_SEARCH_IN,
      },
      [img, chat, reverseSearch],
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: 'rev-1',
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.REVERSE_SEARCH_IN,
      },
      [img, chat, reverseSearch],
    ),
    false,
  );

  const resolved = getConnectedSourceImageForNode(
    'rev-1',
    [img, chat, reverseSearch],
    [
      {
        id: 'e-img-rev',
        source: 'img-1',
        target: 'rev-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.REVERSE_SEARCH_IN,
      },
    ],
  );
  assert.equal(resolved?.id, 'img-1');
  assert.equal(resolved?.imageUrl, 'data:image/png;base64,abc');
});

test('computeChatContextMap separates global and specific handles across images, OCR, and EXIF', () => {
  const imgGlobal = makeImageNode('img-g', 'Global Frame');
  const imgSpecific = makeImageNode('img-s', 'Prompt Frame');
  const ocrSpecific: OsintNode = {
    id: 'ocr-s',
    type: 'ocrNode',
    position: { x: 200, y: 200 },
    data: { kind: 'ocr', title: 'Prompt OCR', extractedText: 'ABC-123' },
  };
  const exifGlobal: OsintNode = {
    id: 'exif-g',
    type: 'exifNode',
    position: { x: 200, y: 400 },
    data: { kind: 'exif', title: 'Global EXIF', summary: null },
  };
  const chat = makeChatNode('chat-1');

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'img-g',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
    {
      id: 'e2',
      source: 'img-s',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
    },
    {
      id: 'e3',
      source: 'ocr-s',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.CHAT_SPECIFIC_IN,
    },
    {
      id: 'e4',
      source: 'exif-g',
      target: 'chat-1',
      sourceHandle: HANDLE_IDS.EXIF_OUT,
      targetHandle: HANDLE_IDS.CHAT_GLOBAL_IN,
    },
  ];

  const contextMap = computeChatContextMap(
    [imgGlobal, imgSpecific, ocrSpecific, exifGlobal, chat],
    edges,
  );
  assert.deepEqual(contextMap['chat-1'].globalImageIds, ['img-g']);
  assert.deepEqual(contextMap['chat-1'].specificImageIds, ['img-s']);
  assert.deepEqual(contextMap['chat-1'].globalOcrIds, []);
  assert.deepEqual(contextMap['chat-1'].specificOcrIds, ['ocr-s']);
  assert.deepEqual(contextMap['chat-1'].globalExifIds, ['exif-g']);
  assert.deepEqual(contextMap['chat-1'].specificExifIds, []);
});

test('validates and reads dragged node types while ignoring OS file drops', () => {
  assert.equal(isDeployableOsintNodeType('imageNode'), true);
  assert.equal(isDeployableOsintNodeType('reverseSearchNode'), true);
  assert.equal(isDeployableOsintNodeType('unknownNode'), false);

  assert.equal(
    hasDraggedNodeType({ types: [NODE_DRAG_MIME_TYPE, 'text/plain'] }),
    true,
  );
  assert.equal(hasDraggedNodeType({ types: ['Files'] }), false);
  assert.equal(hasDraggedNodeType({ types: ['Files', 'text/plain'] }), false);
  assert.equal(hasDraggedNodeType(null), false);

  assert.equal(
    readDraggedNodeType({
      getData: (format) => (format === NODE_DRAG_MIME_TYPE ? 'mapNode' : ''),
    }),
    'mapNode',
  );
  assert.equal(
    readDraggedNodeType({
      getData: (format) => (format === 'text/plain' ? 'ocrNode' : ''),
    }),
    'ocrNode',
  );
  assert.equal(
    readDraggedNodeType({
      getData: () => 'not-a-node',
    }),
    null,
  );
});

test('createOsintNode creates all deployable node types at exact dropped coordinates or staggered defaults', () => {
  assert.deepEqual(computeDroppedNodePosition({ x: 528, y: 322 }), {
    x: 400,
    y: 300,
  });

  for (const nodeType of DEPLOYABLE_NODE_TYPES) {
    const dropped = createOsintNode({
      nodeType,
      index: 12,
      existingNodes: [],
      position: { x: 640, y: 420 },
    });
    assert.equal(dropped.type, nodeType);
    assert.deepEqual(dropped.position, { x: 640, y: 420 });

    const clicked = createOsintNode({
      nodeType,
      index: 12,
      existingNodes: [],
    });
    assert.equal(clicked.type, nodeType);
    assert.equal(typeof clicked.position.x, 'number');
    assert.equal(typeof clicked.position.y, 'number');
  }
});

test('validates ImageNode -> FaceNode connections and rejects invalid sources', () => {
  const img = makeImageNode('img-1', 'Portrait Frame', 'data:image/png;base64,abc');
  const chat = makeChatNode('chat-1');
  const face: OsintNode = {
    id: 'face-1',
    type: 'faceNode',
    position: { x: 600, y: 200 },
    data: {
      kind: 'face',
      title: 'Face Detector 1',
      faceCount: null,
      sourceTitle: null,
    },
  };

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: 'face-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.FACE_IN,
      },
      [img, chat, face],
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: 'face-1',
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.FACE_IN,
      },
      [img, chat, face],
    ),
    false,
  );

  const resolved = getConnectedSourceImageForNode(
    'face-1',
    [img, chat, face],
    [
      {
        id: 'e-img-face',
        source: 'img-1',
        target: 'face-1',
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.FACE_IN,
      },
    ],
  );
  assert.equal(resolved?.id, 'img-1');
  assert.equal(resolved?.imageUrl, 'data:image/png;base64,abc');
});

test('computes non-overlapping spawned ImageNode positions from VideoNode and includes videoCount in case export', () => {
  const videoNode = createOsintNode({
    nodeType: 'videoNode',
    index: 10,
    existingNodes: [],
    position: { x: 100, y: 200 },
  });

  const pos0 = computeSpawnedImageFromVideoPosition(videoNode, [videoNode]);
  assert.deepEqual(pos0, { x: 520, y: 200 });

  const imgA = makeImageNode('img-a', 'Frame A');
  imgA.position = pos0;
  const pos1 = computeSpawnedImageFromVideoPosition(videoNode, [videoNode, imgA]);
  assert.deepEqual(pos1, { x: 810, y: 200 });

  const imgB = makeImageNode('img-b', 'Frame B');
  imgB.position = pos1;
  const pos2 = computeSpawnedImageFromVideoPosition(videoNode, [videoNode, imgA, imgB]);
  assert.deepEqual(pos2, { x: 520, y: 510 });

  const payload = buildCaseExportPayload([videoNode, imgA], []);
  assert.equal(payload.summary.videoCount, 1);
  assert.equal(payload.summary.imageCount, 1);
});

test('validates OcrNode, ExifNode, and ChatNode connections to DorkNode and resolves upstream text', () => {
  const img = makeImageNode('img-1', 'Badge');
  const ocr: OsintNode = {
    id: 'ocr-1',
    type: 'ocrNode',
    position: { x: 200, y: 100 },
    data: {
      kind: 'ocr',
      title: 'OCR 1',
      extractedText: 'Jane Doe\njane.doe@acme-logistics.io',
      confidence: 92,
      sourceTitle: 'Badge',
    },
  };
  const exif: OsintNode = {
    id: 'exif-1',
    type: 'exifNode',
    position: { x: 200, y: 300 },
    data: {
      kind: 'exif',
      title: 'EXIF 1',
      sourceTitle: 'Badge',
      summary: {
        camera: 'Canon EOS R5',
        dateTaken: '2026:07:10 08:30:00',
        gpsCoordinates: '37.774900, -122.419400',
        hasGps: true,
        dimensions: '4000 × 3000',
        fileType: 'JPEG',
      },
    },
  };
  const chat: OsintNode = {
    id: 'chat-1',
    type: 'chatNode',
    position: { x: 200, y: 500 },
    data: {
      kind: 'chat',
      title: 'Thread 1',
      messages: [
        { id: 'm1', role: 'assistant', content: 'Company identified: Acme Logistics', timestamp: '09:00' },
      ],
    },
  };
  const dork = createOsintNode({
    nodeType: 'dorkNode',
    index: 15,
    existingNodes: [],
  });

  const nodes = [img, ocr, exif, chat, dork];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'ocr-1',
        target: dork.id,
        sourceHandle: HANDLE_IDS.OCR_OUT,
        targetHandle: HANDLE_IDS.DORK_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: 'exif-1',
        target: dork.id,
        sourceHandle: HANDLE_IDS.EXIF_OUT,
        targetHandle: HANDLE_IDS.DORK_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: dork.id,
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.DORK_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: dork.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.DORK_IN,
      },
      nodes,
    ),
    false,
  );

  assert.equal(resolveDorkSourceForNode(dork.id, nodes, []), null);

  const resolved = resolveDorkSourceForNode(dork.id, nodes, [
    {
      id: 'e-ocr-dork',
      source: 'ocr-1',
      target: dork.id,
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.DORK_IN,
    },
    {
      id: 'e-exif-dork',
      source: 'exif-1',
      target: dork.id,
      sourceHandle: HANDLE_IDS.EXIF_OUT,
      targetHandle: HANDLE_IDS.DORK_IN,
    },
    {
      id: 'e-chat-dork',
      source: 'chat-1',
      target: dork.id,
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.DORK_IN,
    },
  ]);

  assert.ok(resolved);
  assert.equal(resolved.hasText, true);
  assert.equal(resolved.sources.length, 3);
  assert.match(resolved.combinedText, /jane\.doe@acme-logistics\.io/);
  assert.match(resolved.combinedText, /Canon EOS R5/);
  assert.match(resolved.combinedText, /Acme Logistics/);
});

test('validates ImageNode -> ForensicsNode connections, rejects invalid sources, and counts in case export', () => {
  const img = makeImageNode('img-1', 'Tampered Suspect', 'data:image/png;base64,ela123');
  const chat = makeChatNode('chat-1');
  const forensics = createOsintNode({
    nodeType: 'forensicsNode',
    index: 18,
    existingNodes: [],
  });

  const nodes = [img, chat, forensics];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: forensics.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.FORENSICS_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: forensics.id,
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.FORENSICS_IN,
      },
      nodes,
    ),
    false,
  );

  const resolved = getConnectedSourceImageForNode(forensics.id, nodes, [
    {
      id: 'e-img-forensics',
      source: 'img-1',
      target: forensics.id,
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.FORENSICS_IN,
    },
  ]);

  assert.equal(resolved?.id, 'img-1');
  assert.equal(resolved?.imageUrl, 'data:image/png;base64,ela123');

  const payload = buildCaseExportPayload(nodes, []);
  assert.equal(payload.summary.forensicsCount, 1);
});

test('validates ImageNode -> GeoSpyNode connections, rejects invalid sources, and counts in case export', () => {
  const img = makeImageNode('img-1', 'Harbor Street', 'data:image/jpeg;base64,abc');
  const chat = makeChatNode('chat-1');
  const geoSpy = createOsintNode({
    nodeType: 'geoSpyNode',
    index: 21,
    existingNodes: [],
  });

  const nodes = [img, chat, geoSpy];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: geoSpy.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.GEOSPY_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: geoSpy.id,
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.GEOSPY_IN,
      },
      nodes,
    ),
    false,
  );

  const resolved = getConnectedSourceImageForNode(geoSpy.id, nodes, [
    {
      id: 'e-img-geospy',
      source: 'img-1',
      target: geoSpy.id,
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.GEOSPY_IN,
    },
  ]);

  assert.equal(resolved?.id, 'img-1');
  assert.equal(resolved?.imageUrl, 'data:image/jpeg;base64,abc');

  const payload = buildCaseExportPayload(nodes, []);
  assert.equal(payload.summary.geoSpyCount, 1);
});

test('validates ImageNode -> GeoIntelNode connections, rejects invalid sources, and counts in case export', () => {
  const img = makeImageNode('img-1', 'Street Scene', 'data:image/jpeg;base64,geointel');
  const chat = makeChatNode('chat-1');
  const geoIntel = createOsintNode({
    nodeType: 'geoIntelNode',
    index: 22,
    existingNodes: [],
  });

  const nodes = [img, chat, geoIntel];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: geoIntel.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.GEOINTEL_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: geoIntel.id,
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.GEOINTEL_IN,
      },
      nodes,
    ),
    false,
  );

  const resolved = getConnectedSourceImageForNode(geoIntel.id, nodes, [
    {
      id: 'e-img-geointel',
      source: 'img-1',
      target: geoIntel.id,
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.GEOINTEL_IN,
    },
  ]);

  assert.equal(resolved?.id, 'img-1');
  assert.equal(resolved?.imageUrl, 'data:image/jpeg;base64,geointel');

  const payload = buildCaseExportPayload(nodes, []);
  assert.equal(payload.summary.geoIntelCount, 1);
});

test('validates OcrNode and ChatNode connections to PivotNode, rejects invalid sources, and resolves candidate username', () => {
  const img = makeImageNode('img-1', 'Profile Capture');
  const exif: OsintNode = {
    id: 'exif-1',
    type: 'exifNode',
    position: { x: 200, y: 100 },
    data: {
      kind: 'exif',
      title: 'EXIF 1',
      summary: null,
      sourceTitle: null,
    },
  };
  const ocr: OsintNode = {
    id: 'ocr-1',
    type: 'ocrNode',
    position: { x: 200, y: 260 },
    data: {
      kind: 'ocr',
      title: 'OCR 1',
      extractedText: 'Handle: @octocat',
      confidence: 95,
      sourceTitle: 'Badge',
    },
  };
  const chat: OsintNode = {
    id: 'chat-1',
    type: 'chatNode',
    position: { x: 200, y: 420 },
    data: {
      kind: 'chat',
      title: 'Thread 1',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Profile detected: https://github.com/torvalds',
          timestamp: '09:15',
        },
      ],
    },
  };
  const pivot = createOsintNode({
    nodeType: 'pivotNode',
    index: 25,
    existingNodes: [],
  });

  const nodes = [img, exif, ocr, chat, pivot];

  assert.equal(
    isValidOsintConnection(
      {
        source: 'ocr-1',
        target: pivot.id,
        sourceHandle: HANDLE_IDS.OCR_OUT,
        targetHandle: HANDLE_IDS.PIVOT_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: 'chat-1',
        target: pivot.id,
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.PIVOT_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: 'img-1',
        target: pivot.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.PIVOT_IN,
      },
      nodes,
    ),
    false,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: 'exif-1',
        target: pivot.id,
        sourceHandle: HANDLE_IDS.EXIF_OUT,
        targetHandle: HANDLE_IDS.PIVOT_IN,
      },
      nodes,
    ),
    false,
  );

  assert.equal(resolvePivotSourceForNode(pivot.id, nodes, []), null);

  const fromOcr = resolvePivotSourceForNode(pivot.id, nodes, [
    {
      id: 'e-ocr-pivot',
      source: 'ocr-1',
      target: pivot.id,
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.PIVOT_IN,
    },
  ]);
  assert.equal(fromOcr?.hasText, true);
  assert.equal(fromOcr?.suggestedUsername, 'octocat');

  const fromChat = resolvePivotSourceForNode(pivot.id, nodes, [
    {
      id: 'e-chat-pivot',
      source: 'chat-1',
      target: pivot.id,
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.PIVOT_IN,
    },
  ]);
  assert.equal(fromChat?.hasText, true);
  assert.equal(fromChat?.suggestedUsername, 'torvalds');

  const payload = buildCaseExportPayload(nodes, []);
  assert.equal(payload.summary.pivotCount, 1);
});

test('computes cropped ImageNode position at parent.x + 300 and counts DopplerNode in case export', () => {
  const parent = makeImageNode('img-parent', 'Port Aerial');
  parent.position = { x: 100, y: 200 };

  const pos0 = computeSpawnedCroppedImagePosition(parent, [parent]);
  assert.deepEqual(pos0, { x: 400, y: 200 });

  const child0 = makeImageNode('img-crop-1', 'Cropped: Port Aerial');
  child0.position = pos0;
  const pos1 = computeSpawnedCroppedImagePosition(parent, [parent, child0]);
  assert.deepEqual(pos1, { x: 400, y: 490 });

  const doppler = createOsintNode({
    nodeType: 'dopplerNode',
    index: 30,
    existingNodes: [],
  });
  const payload = buildCaseExportPayload([parent, child0, doppler], []);
  assert.equal(payload.summary.dopplerCount, 1);
  assert.equal(payload.summary.imageCount, 2);
});

test('validates SuspectNode upstream context connections and downstream ImageNode/ResultNode connections', () => {
  const img = createOsintNode({
    nodeType: 'imageNode',
    index: 40,
    existingNodes: [],
  });
  const ocr = createOsintNode({
    nodeType: 'ocrNode',
    index: 41,
    existingNodes: [],
  });
  const chat = createOsintNode({
    nodeType: 'chatNode',
    index: 42,
    existingNodes: [],
  });
  const suspect = createOsintNode({
    nodeType: 'suspectNode',
    index: 43,
    existingNodes: [],
  });
  const result = createOsintNode({
    nodeType: 'resultNode',
    index: 44,
    existingNodes: [],
  });
  const forensics = createOsintNode({
    nodeType: 'forensicsNode',
    index: 45,
    existingNodes: [],
  });
  const nodes = [img, ocr, chat, suspect, result, forensics];

  // Upstream context into SuspectNode
  assert.equal(
    isValidOsintConnection(
      {
        source: img.id,
        target: suspect.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.SUSPECT_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: ocr.id,
        target: suspect.id,
        sourceHandle: HANDLE_IDS.OCR_OUT,
        targetHandle: HANDLE_IDS.SUSPECT_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: chat.id,
        target: suspect.id,
        sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
        targetHandle: HANDLE_IDS.SUSPECT_IN,
      },
      nodes,
    ),
    true,
  );

  // Downstream output from SuspectNode into ImageNode, ResultNode, and ForensicsNode
  assert.equal(
    isValidOsintConnection(
      {
        source: suspect.id,
        target: img.id,
        sourceHandle: HANDLE_IDS.SUSPECT_OUT,
        targetHandle: HANDLE_IDS.IMAGE_LEFT_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: suspect.id,
        target: result.id,
        sourceHandle: HANDLE_IDS.SUSPECT_OUT,
        targetHandle: HANDLE_IDS.RESULT_IN,
      },
      nodes,
    ),
    true,
  );
  assert.equal(
    isValidOsintConnection(
      {
        source: suspect.id,
        target: forensics.id,
        sourceHandle: HANDLE_IDS.SUSPECT_OUT,
        targetHandle: HANDLE_IDS.FORENSICS_IN,
      },
      nodes,
    ),
    true,
  );

  const exportPayload = buildCaseExportPayload(nodes, []);
  assert.equal(exportPayload.summary.suspectCount, 1);
});

test('supports CropNode creation, right-hand placement, EXTRACTED FROM edge validation, and case export', () => {
  assert.equal(isDeployableOsintNodeType('cropNode'), true);
  assert.equal(DEPLOYABLE_NODE_TYPES.includes('cropNode'), true);

  const parent = makeImageNode('img-source', 'Street Frame');
  parent.position = { x: 100, y: 150 };

  const pos0 = computeSpawnedCropNodePosition(parent, [parent]);
  assert.deepEqual(pos0, { x: 480, y: 150 });

  const crop0 = createOsintNode({
    nodeType: 'cropNode',
    index: 50,
    existingNodes: [parent],
    position: pos0,
  });
  assert.equal(crop0.type, 'cropNode');
  assert.equal(crop0.data.kind, 'crop');
  assert.equal(crop0.data.title, '');

  const pos1 = computeSpawnedCropNodePosition(parent, [parent, crop0]);
  assert.deepEqual(pos1, { x: 480, y: 410 });

  const ocr = createOsintNode({
    nodeType: 'ocrNode',
    index: 51,
    existingNodes: [parent, crop0],
  });
  const nodes = [parent, crop0, ocr];

  assert.equal(
    isValidOsintConnection(
      {
        source: parent.id,
        target: crop0.id,
        sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
        targetHandle: HANDLE_IDS.CROP_IN,
      },
      nodes,
    ),
    true,
  );

  assert.equal(
    isValidOsintConnection(
      {
        source: crop0.id,
        target: ocr.id,
        sourceHandle: HANDLE_IDS.CROP_OUT,
        targetHandle: HANDLE_IDS.OCR_IN,
      },
      nodes,
    ),
    true,
  );

  const edges: Edge[] = [
    {
      id: 'edge-extract-1',
      source: parent.id,
      target: crop0.id,
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.CROP_IN,
      type: 'redBezier',
      label: 'EXTRACTED FROM',
    },
  ];

  const payload = buildCaseExportPayload(nodes, edges);
  assert.equal(payload.summary.cropCount, 1);
  assert.equal(payload.connections[0]?.label, 'EXTRACTED FROM');
});
