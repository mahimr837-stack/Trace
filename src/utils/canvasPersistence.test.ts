import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge } from 'reactflow';
import type { OsintNode, OsintProject } from '../types/osint';
import {
  buildSourceImageSignature,
  createDebouncedTask,
  isValidPersistedCanvasState,
  isValidPersistedProjectsState,
  serializeCanvasState,
  serializeProjectsState,
} from './canvasPersistence';

test('serializeCanvasState preserves core graph data and strips transient selection flags', () => {
  const nodes: OsintNode[] = [
    {
      id: 'img-1',
      type: 'imageNode',
      position: { x: 120, y: 240 },
      selected: true,
      dragging: true,
      width: 240,
      height: 260,
      data: {
        kind: 'image',
        title: 'Custom Aerial',
        imageUrl: 'data:image/png;base64,abc123',
        sourceLabel: 'Uploaded',
      },
    },
    {
      id: 'chat-2',
      type: 'chatNode',
      position: { x: 500, y: 200 },
      data: {
        kind: 'chat',
        title: 'Thread 2',
        draftPrompt: 'Inspect crane markings',
        messages: [],
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: 'e-1',
      source: 'img-1',
      target: 'chat-2',
      sourceHandle: 'image-out',
      targetHandle: 'global-context',
      selected: true,
      type: 'redBezier',
    },
  ];

  const serialized = serializeCanvasState({
    nodes,
    edges,
    nodeCounter: 5,
    savedAt: '2026-11-15T22:00:00.000Z',
  });

  assert.equal(serialized.version, 1);
  assert.equal(serialized.nodeCounter, 5);
  assert.equal(serialized.nodes[0]?.position.x, 120);
  assert.equal('selected' in serialized.nodes[0]!, false);
  assert.equal('dragging' in serialized.nodes[0]!, false);
  assert.equal('selected' in serialized.edges[0]!, false);
  assert.equal(
    serialized.nodes[1]?.data.kind === 'chat' ? serialized.nodes[1].data.draftPrompt : '',
    'Inspect crane markings',
  );
  assert.equal(isValidPersistedCanvasState(serialized), true);
});

test('serializeProjectsState normalizes multiple projects and validates with isValidPersistedProjectsState', () => {
  const projects: OsintProject[] = [
    {
      id: 'proj-1',
      name: '  Maritime Vessel Tracking  ',
      createdAt: '2026-11-18T10:00:00.000Z',
      nodeCounter: 3,
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode',
          position: { x: 40, y: 80 },
          selected: true,
          data: {
            kind: 'image',
            title: 'Satellite Pass',
            imageUrl: null,
          },
        },
      ],
      edges: [],
    },
    {
      id: 'proj-2',
      name: 'Urban Geolocation Case',
      createdAt: '2026-11-18T11:00:00.000Z',
      nodes: [],
      edges: [],
    },
  ];

  const serialized = serializeProjectsState({
    projects,
    currentProjectId: 'proj-1',
    savedAt: '2026-11-18T11:30:00.000Z',
  });

  assert.equal(serialized.version, 2);
  assert.equal(serialized.currentProjectId, 'proj-1');
  assert.equal(serialized.projects.length, 2);
  assert.equal(serialized.projects[0]?.name, 'Maritime Vessel Tracking');
  assert.equal('selected' in serialized.projects[0]!.nodes[0]!, false);
  assert.equal(isValidPersistedProjectsState(serialized), true);

  // Empty projects array is also valid (when user deletes all projects)
  const emptySerialized = serializeProjectsState({
    projects: [],
    currentProjectId: 'proj-1',
  });
  assert.equal(emptySerialized.currentProjectId, null);
  assert.equal(emptySerialized.projects.length, 0);
  assert.equal(isValidPersistedProjectsState(emptySerialized), true);
});

test('isValidPersistedCanvasState rejects malformed or outdated payloads', () => {
  assert.equal(isValidPersistedCanvasState(null), false);
  assert.equal(isValidPersistedCanvasState({ version: 2, nodes: [], edges: [], nodeCounter: 1 }), false);
  assert.equal(
    isValidPersistedCanvasState({
      version: 1,
      nodeCounter: 2,
      nodes: [{ id: 'bad-node', position: { x: 'nan', y: 0 }, data: {} }],
      edges: [],
    }),
    false,
  );
  assert.equal(
    isValidPersistedCanvasState({
      version: 1,
      nodeCounter: 1,
      nodes: [],
      edges: [{ id: 'e1', source: 'a' }],
    }),
    false,
  );
  assert.equal(
    isValidPersistedProjectsState({
      version: 2,
      currentProjectId: null,
      projects: [{ id: 'p1', name: 'Bad', createdAt: 'now', nodes: 'not-array', edges: [] }],
    }),
    false,
  );
});

test('buildSourceImageSignature distinguishes image sources and upscale factors', () => {
  const sig2x = buildSourceImageSignature('img-3', 'data:image/png;base64,xyz', 2);
  const sig4x = buildSourceImageSignature('img-3', 'data:image/png;base64,xyz', 4);
  const sigOther = buildSourceImageSignature('img-4', 'data:image/png;base64,xyz', 2);

  assert.ok(sig2x);
  assert.notEqual(sig2x, sig4x);
  assert.notEqual(sig2x, sigOther);
  assert.equal(buildSourceImageSignature(null, 'data:image/png;base64,xyz'), null);
});

test('createDebouncedTask coalesces rapid calls, flushes pending work, and respects cancel', async () => {
  const calls: string[] = [];
  const debounced = createDebouncedTask((val: string) => {
    calls.push(val);
  }, 40);

  debounced.schedule('a');
  debounced.schedule('b');
  debounced.schedule('c');
  assert.equal(debounced.hasPending(), true);
  assert.deepEqual(calls, []);

  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.equal(debounced.hasPending(), false);
  assert.deepEqual(calls, ['c']);

  // Cancel discards pending execution
  debounced.schedule('d');
  assert.equal(debounced.hasPending(), true);
  debounced.cancel();
  assert.equal(debounced.hasPending(), false);
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.deepEqual(calls, ['c']);

  // Flush runs immediately
  debounced.schedule('e');
  debounced.flush();
  assert.equal(debounced.hasPending(), false);
  assert.deepEqual(calls, ['c', 'e']);
});

test('sync backup and pickFresherProject preserve all nodes and prevent stale overwrites', async () => {
  const {
    clearProjectsSyncBackup,
    loadProjectsSyncBackup,
    pickFresherProject,
    saveProjectsSyncBackup,
  } = await import('./canvasPersistence');

  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(k: string) {
        return store.has(k) ? store.get(k)! : null;
      },
      key(i: number) {
        return Array.from(store.keys())[i] ?? null;
      },
      removeItem(k: string) {
        store.delete(k);
      },
      setItem(k: string, v: string) {
        store.set(k, String(v));
      },
    },
    configurable: true,
    writable: true,
  });

  const staleDiskProject: OsintProject = {
    id: 'proj-nav',
    name: 'Case Alpha',
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:01:00.000Z',
    nodeCounter: 2,
    nodes: [
      {
        id: 'img-1',
        type: 'imageNode',
        position: { x: 0, y: 0 },
        data: { kind: 'image', title: 'Frame 1', imageUrl: null },
      },
    ],
    edges: [],
  };

  const fresherLocalProject: OsintProject = {
    ...staleDiskProject,
    updatedAt: '2026-11-21T10:02:00.000Z',
    nodeCounter: 4,
    nodes: [
      ...staleDiskProject.nodes,
      {
        id: 'chat-2',
        type: 'chatNode',
        position: { x: 320, y: 0 },
        data: { kind: 'chat', title: 'Chat 2', messages: [] },
      },
      {
        id: 'archive-3',
        type: 'archiveNode',
        position: { x: 640, y: 0 },
        data: { kind: 'archive', title: 'Archive 3', urlInput: 'example.com', snapshots: [] },
      },
    ],
    edges: [{ id: 'e-1', source: 'img-1', target: 'chat-2', type: 'redBezier' }],
  };

  const summaryStub: OsintProject = {
    id: 'proj-nav',
    name: 'Case Alpha',
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:05:00.000Z',
    nodes: [],
    edges: [],
    nodeCount: 3,
    edgeCount: 1,
    isSummaryOnly: true,
  };

  const savedOk = saveProjectsSyncBackup(
    serializeProjectsState({
      projects: [fresherLocalProject],
      currentProjectId: 'proj-nav',
    }),
  );
  assert.equal(savedOk, true);

  const restored = loadProjectsSyncBackup();
  assert.ok(restored);
  assert.equal(restored.projects[0]?.nodes.length, 3);
  assert.equal(restored.projects[0]?.edges.length, 1);

  // Fresher 3-node local graph beats older 1-node disk file and beats summary-only stub
  const pickedVsDisk = pickFresherProject(staleDiskProject, restored.projects[0]);
  assert.equal(pickedVsDisk?.nodes.length, 3);
  const pickedVsSummary = pickFresherProject(summaryStub, restored.projects[0]);
  assert.equal(pickedVsSummary?.nodes.length, 3);

  clearProjectsSyncBackup();
  assert.equal(loadProjectsSyncBackup(), null);
});
