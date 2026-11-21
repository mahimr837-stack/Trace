import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGlobalApiKey,
  GLOBAL_API_KEY_STORAGE_KEY,
  GLOBAL_PROVIDER_STORAGE_KEY,
  GLOBAL_SETTINGS_STORAGE_KEY,
  isApiAuthError,
  MISSING_API_KEY_CODE,
  MISSING_API_KEY_MESSAGE,
  readGlobalSettings,
  saveGlobalSettings,
} from './globalSettings';
import { runMultiProviderAnalysis } from './llmProviders';
import { requestTargetImageGeneration } from './suspectComposite';
import { generateGoogleDorks } from './dorkGenerator';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

test('persists and reads global provider, API key, and model in localStorage', () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  // Initially empty key
  assert.equal(getGlobalApiKey(), '');
  assert.equal(readGlobalSettings().provider, 'google');

  // Save OpenAI provider and key
  saveGlobalSettings({
    provider: 'openai',
    apiKey: 'sk-openai-global-123',
    model: 'gpt-4o',
  });

  const saved = readGlobalSettings();
  assert.equal(saved.provider, 'openai');
  assert.equal(saved.apiKey, 'sk-openai-global-123');
  assert.equal(saved.model, 'gpt-4o');
  assert.equal(getGlobalApiKey(), 'sk-openai-global-123');
  assert.equal(getGlobalApiKey('openai'), 'sk-openai-global-123');
  assert.equal(mockStorage.getItem(GLOBAL_PROVIDER_STORAGE_KEY), 'openai');
  assert.equal(
    mockStorage.getItem(GLOBAL_API_KEY_STORAGE_KEY),
    'sk-openai-global-123',
  );
  assert.ok(mockStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY));

  mockStorage.clear();
});

test('AI utilities allow server .env fallback when no key is set in localStorage and throw ApiAuthError on 401', async () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  // 1. When backend returns 401 (neither request nor .env has a key), frontend throws ApiAuthError
  const unauthorizedFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    assert.equal('x-api-key' in headers, false);
    assert.equal('apiKey' in body, false);
    return new Response(
      JSON.stringify({
        error: MISSING_API_KEY_MESSAGE,
        code: MISSING_API_KEY_CODE,
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  await assert.rejects(
    () =>
      runMultiProviderAnalysis({
        promptText: 'Analyze harbor cranes.',
        images: [],
        fetchImpl: unauthorizedFetch,
      }),
    (err: unknown) => {
      assert.equal(isApiAuthError(err), true);
      assert.equal((err as Error).message, MISSING_API_KEY_MESSAGE);
      return true;
    },
  );

  await assert.rejects(
    () =>
      generateGoogleDorks({
        targetType: 'General OSINT',
        extractedSourceText: 'alice@acme.io',
        fetchImpl: unauthorizedFetch,
      }),
    (err: unknown) => {
      assert.equal(isApiAuthError(err), true);
      assert.equal((err as Error).message, MISSING_API_KEY_MESSAGE);
      return true;
    },
  );

  await assert.rejects(
    () =>
      requestTargetImageGeneration({
        prompt: 'Suspect composite description',
        fetchImpl: unauthorizedFetch,
      }),
    (err: unknown) => {
      assert.equal(isApiAuthError(err), true);
      assert.equal((err as Error).message, MISSING_API_KEY_MESSAGE);
      return true;
    },
  );

  // 2. When backend has .env fallback configured and returns 200, request succeeds with no localStorage key
  const envFallbackFetch = (async () =>
    new Response(JSON.stringify({ text: 'Verified via server .env key' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  const fallbackText = await runMultiProviderAnalysis({
    promptText: 'Analyze harbor cranes.',
    images: [],
    fetchImpl: envFallbackFetch,
  });
  assert.equal(fallbackText, 'Verified via server .env key');
});

test('AI utilities pass global API key in both x-api-key header and JSON body', async () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  saveGlobalSettings({
    provider: 'anthropic',
    apiKey: 'sk-ant-dashboard-key',
    model: 'claude-3-5-sonnet-latest',
  });

  let capturedLlmBody: Record<string, unknown> | null = null;
  let capturedLlmHeaders: Record<string, string> | null = null;
  const mockLlmFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedLlmHeaders = (init?.headers ?? {}) as Record<string, string>;
    capturedLlmBody = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        text: '1. site:pastebin.com "alice@acme.io"\n2. filetype:pdf "alice@acme.io"',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const dorks = await generateGoogleDorks({
    targetType: 'Documents/Leaks',
    extractedSourceText: 'alice@acme.io',
    fetchImpl: mockLlmFetch,
  });

  assert.equal(dorks.length, 2);
  assert.ok(capturedLlmBody);
  assert.equal(capturedLlmBody?.provider, 'anthropic');
  assert.equal(capturedLlmBody?.apiKey, 'sk-ant-dashboard-key');
  assert.equal(capturedLlmBody?.model, 'claude-3-5-sonnet-latest');
  assert.equal(capturedLlmHeaders?.['x-api-key'], 'sk-ant-dashboard-key');

  saveGlobalSettings({
    provider: 'openai',
    apiKey: 'sk-openai-dashboard-key',
    model: 'gpt-4o',
  });

  let capturedImageBody: Record<string, unknown> | null = null;
  let capturedImageHeaders: Record<string, string> | null = null;
  const mockImageFetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedImageHeaders = (init?.headers ?? {}) as Record<string, string>;
    capturedImageBody = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        imageUrl: 'data:image/png;base64,COMPOSITE',
        model: 'dall-e-3',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const imageRes = await requestTargetImageGeneration({
    prompt: 'Forensic composite',
    fetchImpl: mockImageFetch,
  });

  assert.equal(imageRes.imageUrl, 'data:image/png;base64,COMPOSITE');
  assert.equal(imageRes.modelUsed, 'dall-e-3');
  assert.ok(capturedImageBody);
  assert.equal(capturedImageBody?.provider, 'openai');
  assert.equal(capturedImageBody?.apiKey, 'sk-openai-dashboard-key');
  assert.equal(capturedImageHeaders?.['x-api-key'], 'sk-openai-dashboard-key');

  mockStorage.clear();
});

test('auto-migrates legacy gemini-4-hydrogen model to gemini-2.5-flash and aborts hung requests on timeout', async () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  mockStorage.setItem(
    GLOBAL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      provider: 'google',
      apiKey: 'AIzaSyTestKey',
      model: 'gemini-4-hydrogen',
      providerConfigs: {
        google: { apiKey: 'AIzaSyTestKey', model: 'gemini-4-hydrogen' },
      },
    }),
  );

  const migrated = readGlobalSettings();
  assert.equal(migrated.model, 'gemini-2.5-flash');
  assert.equal(migrated.providerConfigs.google.model, 'gemini-2.5-flash');

  const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        reject(abortErr);
      });
    })) as typeof fetch;

  await assert.rejects(
    () =>
      runMultiProviderAnalysis({
        provider: 'google',
        apiKey: 'AIzaSyTestKey',
        promptText: 'Ping',
        images: [],
        fetchImpl: hangingFetch,
        timeoutMs: 30,
      }),
    /timed out/i,
  );

  mockStorage.clear();
});
