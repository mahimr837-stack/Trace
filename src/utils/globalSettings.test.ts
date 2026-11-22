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

test('auto-migrates invalid Gemini model names to gemini-1.5-flash, blocks non-vision models like recraft, and aborts hung requests on timeout', async () => {
  const { NON_VISION_MODEL_WARNING } = await import('./llmProviders');
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
      model: 'gemini-99-invalid',
      providerConfigs: {
        google: { apiKey: 'AIzaSyTestKey', model: 'gemini-99-invalid' },
      },
    }),
  );

  const migrated = readGlobalSettings();
  assert.equal(migrated.model, 'gemini-1.5-flash');
  assert.equal(migrated.providerConfigs.google.model, 'gemini-1.5-flash');

  // Non-vision models like recraft are intercepted on the frontend when images are attached
  await assert.rejects(
    () =>
      runMultiProviderAnalysis({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        model: 'recraft-v3',
        promptText: 'Analyze image.',
        images: [{ mimeType: 'image/png', data: 'AAA' }],
      }),
    {
      message: NON_VISION_MODEL_WARNING,
    },
  );

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

test('persists custom providers, parses /models responses, and routes Chat/Dork/Suspect calls through custom baseUrl', async () => {
  const {
    getActiveCustomProvider,
    saveCustomProviders,
  } = await import('./globalSettings');
  const {
    buildOpenAiCompatibleRequest,
    fetchProviderModels,
    parseAvailableModelsResponse,
    resolveModelsEndpointUrl,
  } = await import('./llmProviders');

  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  assert.equal(
    resolveModelsEndpointUrl('https://openrouter.ai/api/v1/', 'openai'),
    'https://openrouter.ai/api/v1/models',
  );
  assert.equal(
    resolveModelsEndpointUrl('https://api.anthropic.com', 'anthropic'),
    'https://api.anthropic.com/v1/models',
  );

  const parsed = parseAvailableModelsResponse({
    data: [
      { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
      { id: 'anthropic/claude-3.5-sonnet', display_name: 'Claude 3.5 Sonnet' },
    ],
  });
  assert.deepEqual(parsed, [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
  ]);

  const fetched = await fetchProviderModels({
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or-custom-123',
    providerType: 'openai',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), '/api/providers/models');
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      assert.equal(body.baseUrl, 'https://openrouter.ai/api/v1');
      assert.equal(body.apiKey, 'sk-or-custom-123');
      assert.equal(body.providerType, 'openai');
      return new Response(
        JSON.stringify({
          models: [{ id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0]?.id, 'openai/gpt-4o');

  saveCustomProviders({
    customProviders: [
      {
        id: 'custom-or-1',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1/',
        apiKey: 'sk-or-live-999',
        providerType: 'openai',
        model: 'openai/gpt-4o',
      },
    ],
    activeCustomProviderId: 'custom-or-1',
  });

  const active = getActiveCustomProvider();
  assert.ok(active);
  assert.equal(active?.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(active?.apiKey, 'sk-or-live-999');
  assert.equal(active?.model, 'openai/gpt-4o');

  const customOpenAiSpec = buildOpenAiCompatibleRequest({
    provider: 'openai',
    apiKey: 'sk-or-live-999',
    model: 'openai/gpt-4o',
    promptText: 'Inspect frame',
    images: [],
    baseUrl: 'https://openrouter.ai/api/v1',
  });
  assert.equal(
    customOpenAiSpec.url,
    'https://openrouter.ai/api/v1/chat/completions',
  );
  assert.equal(customOpenAiSpec.headers.Authorization, 'Bearer sk-or-live-999');

  let capturedLlmBody: Record<string, unknown> | null = null;
  await runMultiProviderAnalysis({
    promptText: 'Analyze target',
    images: [],
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedLlmBody = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      return new Response(JSON.stringify({ text: 'Custom analysis OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });
  assert.equal(capturedLlmBody?.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(capturedLlmBody?.providerType, 'openai');
  assert.equal(capturedLlmBody?.apiKey, 'sk-or-live-999');
  assert.equal(capturedLlmBody?.model, 'openai/gpt-4o');

  let capturedDorkBody: Record<string, unknown> | null = null;
  const dorks = await generateGoogleDorks({
    targetType: 'General OSINT',
    extractedSourceText: 'target@domain.com',
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedDorkBody = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({ text: 'site:github.com "target@domain.com"' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });
  assert.equal(dorks.length, 1);
  assert.equal(capturedDorkBody?.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(capturedDorkBody?.apiKey, 'sk-or-live-999');

  let capturedSuspectBody: Record<string, unknown> | null = null;
  await requestTargetImageGeneration({
    prompt: 'Forensic sketch',
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSuspectBody = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          imageUrl: 'data:image/png;base64,CUSTOM',
          model: 'openai/gpt-4o',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });
  assert.equal(capturedSuspectBody?.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(capturedSuspectBody?.providerType, 'openai');
  assert.equal(capturedSuspectBody?.apiKey, 'sk-or-live-999');

  mockStorage.clear();
});
