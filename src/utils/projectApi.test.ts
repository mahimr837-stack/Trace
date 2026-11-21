import test from 'node:test';
import assert from 'node:assert/strict';
import type { OsintProject } from '../types/osint';
import {
  buildProjectSavePayload,
  deleteProjectOnServer,
  fetchProjectById,
  fetchProjectList,
  PROJECTS_LIST_ENDPOINT,
  PROJECTS_SAVE_ENDPOINT,
  saveProjectToServer,
} from './projectApi';

test('buildProjectSavePayload strips transient ReactFlow UI flags and normalizes metadata', () => {
  const project: OsintProject = {
    id: 'proj-case-42',
    name: '  Port Recon  ',
    createdAt: '2026-11-21T10:00:00.000Z',
    nodeCounter: 3,
    nodes: [
      {
        id: 'img-1',
        type: 'imageNode',
        position: { x: 100, y: 200 },
        selected: true,
        dragging: true,
        data: { kind: 'image', title: 'Dock Frame', imageUrl: null },
      },
    ],
    edges: [
      {
        id: 'e-1',
        source: 'img-1',
        target: 'chat-1',
        selected: true,
        type: 'redBezier',
      },
    ],
  };

  const payload = buildProjectSavePayload(project);
  assert.equal(payload.id, 'proj-case-42');
  assert.equal(payload.name, 'Port Recon');
  assert.equal(payload.nodeCounter, 3);
  assert.equal('selected' in payload.nodes[0], false);
  assert.equal('dragging' in payload.nodes[0], false);
  assert.equal('selected' in payload.edges[0], false);
});

test('projectApi client calls /api/projects, /api/projects/save, and /api/projects/:id cleanly', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: urlStr, method, body: init?.body ? String(init.body) : undefined });

    if (urlStr === PROJECTS_SAVE_ENDPOINT && method === 'POST') {
      return new Response(
        JSON.stringify({
          ok: true,
          id: 'proj-fs-1',
          name: 'Filesystem Case',
          createdAt: '2026-11-21T12:00:00.000Z',
          updatedAt: '2026-11-21T12:01:00.000Z',
          nodeCount: 1,
          edgeCount: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (urlStr === PROJECTS_LIST_ENDPOINT && method === 'GET') {
      return new Response(
        JSON.stringify({
          projects: [
            {
              id: 'proj-fs-1',
              name: 'Filesystem Case',
              createdAt: '2026-11-21T12:00:00.000Z',
              updatedAt: '2026-11-21T12:01:00.000Z',
              nodeCount: 1,
              edgeCount: 0,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (urlStr === `${PROJECTS_LIST_ENDPOINT}/proj-fs-1` && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'proj-fs-1',
          name: 'Filesystem Case',
          createdAt: '2026-11-21T12:00:00.000Z',
          nodeCounter: 2,
          nodes: [
            {
              id: 'img-1',
              type: 'imageNode',
              position: { x: 10, y: 20 },
              data: { kind: 'image', title: 'Evidence', imageUrl: null },
            },
          ],
          edges: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (urlStr === `${PROJECTS_LIST_ENDPOINT}/proj-fs-1` && method === 'DELETE') {
      return new Response(JSON.stringify({ ok: true, id: 'proj-fs-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }) as typeof fetch;

  const saved = await saveProjectToServer(
    {
      id: 'proj-fs-1',
      name: 'Filesystem Case',
      createdAt: '2026-11-21T12:00:00.000Z',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode',
          position: { x: 10, y: 20 },
          data: { kind: 'image', title: 'Evidence', imageUrl: null },
        },
      ],
      edges: [],
      nodeCounter: 2,
    },
    mockFetch,
  );
  assert.equal(saved.id, 'proj-fs-1');
  assert.equal(saved.nodeCount, 1);

  const list = await fetchProjectList(mockFetch);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'Filesystem Case');

  const loaded = await fetchProjectById('proj-fs-1', mockFetch);
  assert.ok(loaded);
  assert.equal(loaded.nodes.length, 1);
  assert.equal(loaded.isSummaryOnly, false);

  const missing = await fetchProjectById('proj-missing', mockFetch);
  assert.equal(missing, null);

  const deleted = await deleteProjectOnServer('proj-fs-1', mockFetch);
  assert.equal(deleted, true);

  assert.equal(calls.length, 5);
});
