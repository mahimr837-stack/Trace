import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnthropicRequest,
  buildGeminiServerRequest,
  buildLlmProxyRequest,
  buildOpenAiCompatibleRequest,
  extractAnthropicResponseText,
  extractOpenAiResponseText,
  LLM_PROVIDERS,
} from './llmProviders';

test('lists all six expected LLM providers with server environment variable names', () => {
  assert.deepEqual(
    LLM_PROVIDERS.map((p) => p.name),
    ['Anthropic', 'OpenAI', 'OpenRouter', 'Google', 'DeepSeek', 'Mistral'],
  );
  assert.deepEqual(
    LLM_PROVIDERS.map((p) => p.envVarName),
    [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
      'DEEPSEEK_API_KEY',
      'MISTRAL_API_KEY',
    ],
  );
  for (const provider of LLM_PROVIDERS) {
    assert.match(provider.consoleUrl, /^https:\/\//);
  }
});

test('builds unified server-side LLM proxy request payload without client API key headers', () => {
  const anthropicProxySpec = buildLlmProxyRequest({
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    promptText: 'Inspect crane shadow azimuth.',
    images: [{ mimeType: 'image/png', data: 'BASE64PNG' }],
    systemPrompt: 'You are a GEOINT analyst.',
  });

  assert.equal(anthropicProxySpec.url, '/api/llm/generate');
  assert.deepEqual(anthropicProxySpec.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(anthropicProxySpec.body, {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    promptText: 'Inspect crane shadow azimuth.',
    images: [{ mimeType: 'image/png', data: 'BASE64PNG' }],
    systemPrompt: 'You are a GEOINT analyst.',
  });

  const geminiSpec = buildGeminiServerRequest({
    model: 'gemini-1.5-flash',
    promptText: 'Inspect crane shadow azimuth.',
    images: [{ mimeType: 'image/png', data: 'BASE64PNG' }],
    systemPrompt: 'You are a GEOINT analyst.',
  });

  assert.equal(geminiSpec.url, '/api/gemini/generate');
  assert.deepEqual(geminiSpec.headers, { 'Content-Type': 'application/json' });
});

test('builds OpenAI-compatible multimodal Chat Completions payload for OpenAI and OpenRouter on server', () => {
  const openRouterSpec = buildOpenAiCompatibleRequest({
    provider: 'openrouter',
    apiKey: 'sk-or-test-key',
    model: 'anthropic/claude-3.5-sonnet',
    promptText: 'Inspect container lettering.',
    images: [{ mimeType: 'image/jpeg', data: 'BASE64JPEGDATA' }],
    origin: 'http://localhost:3000',
  });

  assert.equal(openRouterSpec.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(openRouterSpec.headers.Authorization, 'Bearer sk-or-test-key');
  assert.equal(openRouterSpec.headers['HTTP-Referer'], 'http://localhost:3000');
  assert.equal(openRouterSpec.body.model, 'anthropic/claude-3.5-sonnet');
  const content = openRouterSpec.body.messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content, [
    { type: 'text', text: 'Inspect container lettering.' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,BASE64JPEGDATA' },
    },
  ]);

  const openAiSpec = buildOpenAiCompatibleRequest({
    provider: 'openai',
    apiKey: 'sk-openai-key',
    model: 'openai/gpt-4o',
    promptText: 'Check shadows.',
    images: [{ mimeType: 'image/png', data: 'PNGDATA' }],
  });

  assert.equal(openAiSpec.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openAiSpec.headers.Authorization, 'Bearer sk-openai-key');
  assert.equal(openAiSpec.body.model, 'openai/gpt-4o');
  assert.ok(Array.isArray(openAiSpec.body.messages[0]?.content));
});

test('builds Anthropic multimodal Messages API payload and extracts text responses', () => {
  const spec = buildAnthropicRequest({
    apiKey: 'sk-ant-test',
    model: 'claude-3-5-sonnet-latest',
    promptText: 'Analyze port geometry.',
    images: [{ mimeType: 'image/webp', data: 'WEBPDATA' }],
  });

  assert.equal(spec.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(spec.headers['x-api-key'], 'sk-ant-test');
  assert.equal(spec.headers['anthropic-version'], '2023-06-01');
  assert.equal(
    'anthropic-dangerous-direct-browser-access' in spec.headers,
    false,
  );
  assert.deepEqual(spec.body.messages[0]?.content, [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/webp',
        data: 'WEBPDATA',
      },
    },
    {
      type: 'text',
      text: 'Analyze port geometry.',
    },
  ]);

  assert.equal(
    extractAnthropicResponseText({
      content: [{ type: 'text', text: 'Confirmed crane berth 4.' }],
    }),
    'Confirmed crane berth 4.',
  );

  assert.equal(
    extractOpenAiResponseText({
      choices: [{ message: { content: 'Detected vessel hull number.' } }],
    }),
    'Detected vessel hull number.',
  );
});

test('includes optional systemPrompt across OpenAI-compatible and Anthropic request payloads', () => {
  const openAiWithSystem = buildOpenAiCompatibleRequest({
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    promptText: 'Target Type: General OSINT\n\nalice@acme.io',
    images: [],
    systemPrompt: 'You are an elite OSINT investigator.',
  });
  assert.deepEqual(openAiWithSystem.body.messages, [
    { role: 'system', content: 'You are an elite OSINT investigator.' },
    { role: 'user', content: 'Target Type: General OSINT\n\nalice@acme.io' },
  ]);

  const anthropicWithSystem = buildAnthropicRequest({
    apiKey: 'sk-ant',
    model: 'claude-3-5-sonnet-latest',
    promptText: 'Target Type: Social Media\n\nalice@acme.io',
    images: [],
    systemPrompt: 'You are an elite OSINT investigator.',
  });
  assert.equal(anthropicWithSystem.body.system, 'You are an elite OSINT investigator.');
});
