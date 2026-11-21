// Smoke test for the consolidated Traceboard server (port 3000).
// Run: NODE_OPTIONS="--dns-result-order=ipv4first" node scripts/smoke-test.js
import WebSocket from 'ws';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Frontend SPA + Mobile Companion + Health + Providers Status
const rootRes = await fetch(`${BASE}/`);
const rootHtml = await rootRes.text();
check(
  'GET / (Trace | OSINT Canvas HTML)',
  rootRes.status === 200 && rootHtml.includes('<title>Trace | OSINT Canvas</title>'),
  `HTTP ${rootRes.status}`,
);

const spaRes = await fetch(`${BASE}/dashboard`);
const spaHtml = await spaRes.text();
check(
  'GET /dashboard (SPA fallback)',
  spaRes.status === 200 && spaHtml.includes('<title>Trace | OSINT Canvas</title>'),
  `HTTP ${spaRes.status}`,
);

const mobileRes = await fetch(`${BASE}/mobile`);
const mobileHtml = await mobileRes.text();
check(
  'GET /mobile (Mobile Companion App)',
  mobileRes.status === 200 && mobileHtml.includes('<div id="root"></div>'),
  `HTTP ${mobileRes.status}`,
);

const health = await fetch(`${BASE}/api/health`).then(async (r) => [r.status, await r.json()]);
check('GET /api/health', health[0] === 200 && health[1].status === 'ok', JSON.stringify(health[1]));

const providers = await fetch(`${BASE}/api/providers/status`).then(async (r) => [r.status, await r.json()]);
check('GET /api/providers/status', providers[0] === 200 && typeof providers[1].providers === 'object', `HTTP ${providers[0]}`);

// 2. CORS: allowed vs disallowed origins
for (const [origin, expectAllowed] of [
  ['http://localhost:3000', true],
  ['http://localhost:5173', true],
  ['http://evil.example', false],
]) {
  const r = await fetch(`${BASE}/api/health`, { headers: { Origin: origin } });
  const acao = r.headers.get('access-control-allow-origin');
  check(`CORS ${origin}`, expectAllowed ? acao === origin : acao === null, `ACAO=${acao}`);
}

// 3. Native OSINT Pivot: known username ("octocat") + unsafe username rejection
const pivot = await fetch(`${BASE}/api/osint/pivot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'octocat' }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/osint/pivot (octocat)',
  pivot[0] === 200 &&
    pivot[1].source === 'native' &&
    Array.isArray(pivot[1].found) &&
    pivot[1].found.includes('https://github.com/octocat'),
  `source=${pivot[1].source}, found=${JSON.stringify(pivot[1].found)}`,
);

const bad = await fetch(`${BASE}/api/osint/pivot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x; rm -rf /' }),
});
check('POST /api/osint/pivot rejects unsafe username', bad.status === 400, `HTTP ${bad.status}`);

// 3b. Shodan Proxy validation (missing query -> 400, missing API key -> 403)
const shodanNoQuery = await fetch(`${BASE}/api/osint/shodan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '' }),
});
check('POST /api/osint/shodan rejects empty query', shodanNoQuery.status === 400, `HTTP ${shodanNoQuery.status}`);

const shodanNoKey = await fetch(`${BASE}/api/osint/shodan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '8.8.8.8' }),
});
check('POST /api/osint/shodan requires API key', shodanNoKey.status === 403, `HTTP ${shodanNoKey.status}`);

// 3c. Wayback Archive Proxy (validation + live CDX query for example.com)
const archiveBad = await fetch(`${BASE}/api/osint/archive`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: '' }),
});
check('POST /api/osint/archive rejects empty url', archiveBad.status === 400, `HTTP ${archiveBad.status}`);

const archiveLive = await fetch(`${BASE}/api/osint/archive`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'example.com' }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/osint/archive (example.com)',
  archiveLive[0] === 200 &&
    Array.isArray(archiveLive[1]?.snapshots) &&
    archiveLive[1].snapshots.length > 0 &&
    archiveLive[1].snapshots[0].snapshotUrl.startsWith('https://web.archive.org/web/'),
  `HTTP ${archiveLive[0]}, snapshots=${archiveLive[1]?.snapshots?.length ?? 0}`,
);

// 3d. AI endpoints return clean 401 when neither request nor .env provides a key
const llmNoKey = await fetch(`${BASE}/api/llm/complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'anthropic', promptText: 'Ping' }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/llm/complete returns 401 when no key configured',
  llmNoKey[0] === 401 && llmNoKey[1]?.code === 'MISSING_API_KEY',
  `HTTP ${llmNoKey[0]}, code=${llmNoKey[1]?.code}`,
);

const imageNoKey = await fetch(`${BASE}/api/image/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'openai', prompt: 'Composite test' }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/image/generate returns 401 when no key configured',
  imageNoKey[0] === 401 && imageNoKey[1]?.code === 'MISSING_API_KEY',
  `HTTP ${imageNoKey[0]}, code=${imageNoKey[1]?.code}`,
);

const invalidGeminiModel = await fetch(`${BASE}/api/llm/complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'google',
    model: 'gemini-99-nonexistent',
    promptText: 'Ping',
  }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/llm/complete rejects invalid Gemini model name immediately',
  invalidGeminiModel[0] === 400 &&
    invalidGeminiModel[1]?.error === 'Invalid Gemini model name',
  `HTTP ${invalidGeminiModel[0]}, error=${invalidGeminiModel[1]?.error}`,
);

// 3e. Local Filesystem Project Persistence (/api/projects/save, /api/projects, /api/projects/:id, DELETE)
const smokeProjId = `smoke-proj-${Date.now()}`;
const saveProj = await fetch(`${BASE}/api/projects/save`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: smokeProjId,
    name: 'Smoke Test Case',
    createdAt: '2026-11-21T12:00:00.000Z',
    nodeCounter: 2,
    nodes: [
      {
        id: 'img-1',
        type: 'imageNode',
        position: { x: 40, y: 80 },
        data: { kind: 'image', title: 'Smoke Evidence', imageUrl: null },
      },
    ],
    edges: [],
  }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/projects/save persists project JSON to /data',
  saveProj[0] === 200 && saveProj[1]?.ok === true && saveProj[1]?.id === smokeProjId,
  `HTTP ${saveProj[0]}, id=${saveProj[1]?.id}`,
);

const listProj = await fetch(`${BASE}/api/projects`).then(async (r) => [
  r.status,
  await r.json(),
]);
check(
  'GET /api/projects lists saved project',
  listProj[0] === 200 &&
    Array.isArray(listProj[1]?.projects) &&
    listProj[1].projects.some(
      (p) => p.id === smokeProjId && p.name === 'Smoke Test Case' && p.nodeCount === 1,
    ),
  `HTTP ${listProj[0]}, count=${listProj[1]?.projects?.length ?? 0}`,
);

const loadProj = await fetch(`${BASE}/api/projects/${smokeProjId}`).then(async (r) => [
  r.status,
  await r.json(),
]);
check(
  'GET /api/projects/:id loads saved project JSON',
  loadProj[0] === 200 &&
    loadProj[1]?.id === smokeProjId &&
    Array.isArray(loadProj[1]?.nodes) &&
    loadProj[1].nodes.length === 1,
  `HTTP ${loadProj[0]}, nodes=${loadProj[1]?.nodes?.length ?? 0}`,
);

const traversalProj = await fetch(`${BASE}/api/projects/..%2Fpackage.json`);
check(
  'GET /api/projects/:id blocks path traversal',
  traversalProj.status === 400,
  `HTTP ${traversalProj.status}`,
);

const delProj = await fetch(`${BASE}/api/projects/${smokeProjId}`, {
  method: 'DELETE',
}).then(async (r) => [r.status, await r.json()]);
check(
  'DELETE /api/projects/:id cleans up saved project',
  delProj[0] === 200 && delProj[1]?.ok === true,
  `HTTP ${delProj[0]}`,
);

// 4. WebSocket PIN Authentication (GET /api/sync/pin, 4001 on wrong/missing PIN, relay when authenticated)
const pinRes = await fetch(`${BASE}/api/sync/pin`).then(async (r) => [r.status, await r.json()]);
const validPin = typeof pinRes[1]?.pin === 'string' ? pinRes[1].pin : '';
check(
  'GET /api/sync/pin (loopback 6-digit PIN)',
  pinRes[0] === 200 && /^\d{6}$/.test(validPin),
  `PIN=${validPin || 'none'}`,
);

const wsUrl = BASE.replace(/^http/, 'ws') + '/sync';
const wrongPin = validPin === '000000' ? '111111' : '000000';

// 4a. Wrong PIN must be closed immediately with code 4001
await new Promise((resolve) => {
  const ws = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    check('WebSocket wrong PIN closed with 4001', false, 'timeout');
    ws.terminate();
    resolve();
  }, 4000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', pin: wrongPin }));
  });
  ws.on('close', (code) => {
    clearTimeout(timer);
    check('WebSocket wrong PIN closed with 4001', code === 4001, `code=${code}`);
    resolve();
  });
  ws.on('error', () => {});
});

// 4b. Unauthenticated payload (missing auth handshake) must be closed immediately with code 4001
await new Promise((resolve) => {
  const ws = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    check('WebSocket missing auth closed with 4001', false, 'timeout');
    ws.terminate();
    resolve();
  }, 4000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ target_id: 'new', image_base64: 'data:image/png;base64,AAA=' }));
  });
  ws.on('close', (code) => {
    clearTimeout(timer);
    check('WebSocket missing auth closed with 4001', code === 4001, `code=${code}`);
    resolve();
  });
  ws.on('error', () => {});
});

// 4c. Authenticated broadcast relay on /sync (sender -> receiver, text + binary, no self-echo)
await new Promise((resolve) => {
  const receiver = new WebSocket(wsUrl);
  const sender = new WebSocket(wsUrl);
  const textPayload = JSON.stringify({
    target_id: 'new',
    image_base64: 'data:image/png;base64,iVBORw0KGgo=',
  });
  const binary = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const received = [];
  let senderEchoed = false;
  let authOkCount = 0;

  const done = () => {
    clearTimeout(timer);
    receiver.close();
    sender.close();
    resolve();
  };

  const timer = setTimeout(() => {
    check('WebSocket /sync authenticated relay', false, 'timeout');
    receiver.terminate();
    sender.terminate();
    resolve();
  }, 5000);

  const authPayload = JSON.stringify({ type: 'auth', pin: validPin });
  sender.on('open', () => sender.send(authPayload));
  receiver.on('open', () => receiver.send(authPayload));

  const onAuthOk = () => {
    authOkCount++;
    if (authOkCount === 2) {
      sender.send(textPayload);
      sender.send(binary);
    }
  };

  sender.on('message', (data, isBinary) => {
    if (!isBinary) {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.type === 'auth_ok') {
          onAuthOk();
          return;
        }
      } catch {}
    }
    senderEchoed = true;
  });

  receiver.on('message', (data, isBinary) => {
    if (!isBinary) {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.type === 'auth_ok') {
          onAuthOk();
          return;
        }
      } catch {}
    }
    received.push({ data, isBinary });
    if (received.length === 2) {
      setTimeout(() => {
        check(
          'WebSocket authenticated text relay',
          !received[0].isBinary && received[0].data.toString() === textPayload,
        );
        check(
          'WebSocket authenticated binary relay',
          received[1].isBinary && Buffer.compare(received[1].data, binary) === 0,
          `${received[1].data.length} bytes`,
        );
        check('WebSocket no self-echo', !senderEchoed);
        done();
      }, 100);
    }
  });

  const onErr = (e) => {
    clearTimeout(timer);
    check('WebSocket /sync connect', false, e.message);
    done();
  };
  sender.on('error', onErr);
  receiver.on('error', onErr);
});

// 5. WebSocket on a wrong path must be rejected
await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/nope');
  ws.on('open', () => {
    check('WebSocket wrong path rejected', false);
    ws.close();
    resolve();
  });
  ws.on('error', () => {
    check('WebSocket wrong path rejected', true);
    resolve();
  });
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
