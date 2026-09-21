import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider } from '../.test-build/lib/types.js';
import {
  parseRepoUrl,
  repositoryTree,
  repositoryFile,
} from '../.test-build/lib/repository.js';
import { parseAnalysis, splitSource } from '../.test-build/lib/analysis.js';
import { listModels, generate } from '../.test-build/lib/providers.js';
import { POST as analyze } from '../.test-build/app/api/analyze/route.js';
import { POST as models } from '../.test-build/app/api/models/route.js';
import { POST as repository } from '../.test-build/app/api/repository/route.js';
const nativeFetch = global.fetch;
const nativeInfo = console.info,
  nativeError = console.error;
beforeEach(() => {
  console.info = () => {};
  console.error = () => {};
});
afterEach(() => {
  global.fetch = nativeFetch;
  console.info = nativeInfo;
  console.error = nativeError;
});
const answer = {
  summary: 'A function.',
  steps: [
    {
      title: 'Return a value',
      explanation: 'The function returns one.',
      startLine: 1,
      endLine: 3,
    },
  ],
};
const req = (data, headers = {}) =>
  new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
const credentials = {
  key: 'test-secret',
  provider: 'openai',
  model: 'gpt-test',
};

test('detects distinctive prefixes and leaves ambiguous keys for manual choice', () => {
  assert.equal(detectProvider('sk-ant-test'), 'anthropic');
  assert.equal(detectProvider('AIza-test'), 'gemini');
  assert.equal(detectProvider('sk-proj-test'), 'openai');
  assert.equal(detectProvider('sk-ambiguous'), '');
});
test('repository URL parser rejects arbitrary hosts, credentials, ports, and deep paths', () => {
  assert.deepEqual(parseRepoUrl('github.com/owner/repo.git'), {
    owner: 'owner',
    name: 'repo',
  });
  for (const url of [
    'https://evil.com/a/b',
    'https://github.com.evil.com/a/b',
    'https://a@github.com/a/b',
    'https://github.com:444/a/b',
    'https://github.com/a/b/tree/main',
    'http://127.0.0.1/a/b',
  ])
    assert.throws(() => parseRepoUrl(url));
});
test('walkthrough rejects gaps, out-of-bounds lines, and incomplete file maps', () => {
  assert.deepEqual(
    parseAnalysis(JSON.stringify(answer), { start: 1, end: 3, full: true }),
    answer,
  );
  assert.throws(() =>
    parseAnalysis(JSON.stringify(answer), { start: 1, end: 2 }),
  );
  assert.throws(() =>
    parseAnalysis(
      JSON.stringify({
        ...answer,
        steps: [{ ...answer.steps[0], startLine: 2 }],
      }),
      { start: 1, end: 3, full: true },
    ),
  );
  assert.throws(() =>
    parseAnalysis(
      JSON.stringify({
        ...answer,
        steps: [{ ...answer.steps[0], path: 'a.ts' }],
      }),
      { paths: ['a.ts', 'b.ts'] },
    ),
  );
  assert.throws(() => parseAnalysis('not JSON', {}));
});
test('source chunking preserves every line and absolute ranges', () => {
  const content = Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n');
  const chunks = splitSource(content);
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].start, 1);
  assert.equal(chunks.at(-1).end, 800);
  for (let i = 1; i < chunks.length; i++)
    assert.equal(chunks[i].start, chunks[i - 1].end + 1);
  assert.equal(
    chunks
      .map((c) => c.text)
      .join('')
      .split('\n')
      .filter(Boolean).length,
    800,
  );
});
test('OpenAI model discovery filters non-text models and authenticates only to OpenAI', async () => {
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    return Response.json({
      data: [
        { id: 'gpt-test' },
        { id: 'gpt-audio' },
        { id: 'gpt-3.5-turbo' },
        { id: 'gpt-4-turbo' },
        { id: 'text-embedding-3-small' },
      ],
    });
  };
  assert.deepEqual(await listModels('openai', 'secret'), [
    { id: 'gpt-test', name: 'gpt-test' },
  ]);
});
test('Anthropic and Gemini model pagination discovers subsequent pages', async () => {
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(init.headers['x-api-key'], 'secret');
    return Response.json(
      calls === 1
        ? { data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }
        : { data: [{ id: 'claude-b' }], has_more: false },
    );
  };
  assert.equal((await listModels('anthropic', 'secret')).length, 2);
  assert.equal(calls, 2);
  calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(init.headers['x-goog-api-key'], 'secret');
    return Response.json(
      calls === 1
        ? {
            models: [
              {
                name: 'models/gemini-a',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
            nextPageToken: 'next',
          }
        : {
            models: [
              {
                name: 'models/gemini-b',
                supportedGenerationMethods: ['generateContent'],
              },
              {
                name: 'models/embedding',
                supportedGenerationMethods: ['embedContent'],
              },
            ],
          },
    );
  };
  assert.equal((await listModels('gemini', 'secret')).length, 2);
  assert.equal(calls, 2);
});
test('all generation adapters normalize text and send provider-specific credentials', async () => {
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    global.fetch = async (url, init) => {
      const data = JSON.parse(init.body);
      assert.ok(!url.includes('secret'));
      if (provider === 'openai') {
        assert.equal(data.store, false);
        return Response.json({
          output: [{ content: [{ type: 'output_text', text: 'result' }] }],
        });
      }
      if (provider === 'anthropic')
        return Response.json({ content: [{ type: 'text', text: 'result' }] });
      return Response.json({
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: 'result' }] } },
        ],
      });
    };
    assert.equal(
      await generate(provider, 'secret', 'model', 'prompt'),
      'result',
    );
  }
});
test('file analysis route runs the complete source through the provider and validates output', async () => {
  global.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    assert.match(payload.input, /1: function/);
    assert.match(payload.input, /Explain ALL lines/);
    return Response.json({
      output: [
        { content: [{ type: 'output_text', text: JSON.stringify(answer) }] },
      ],
    });
  };
  const response = await analyze(
    req({
      ...credentials,
      mode: 'file',
      question: '',
      file: { path: 'a.js', content: 'function one() {\nreturn 1;\n}' },
      paths: ['a.js'],
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual({ summary: result.summary, steps: result.steps }, answer);
  assert.equal(result.usage.length, 1);
  assert.equal(typeof result.requestId, 'string');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('question mode focuses its prompt and permits relevant subsets', async () => {
  global.fetch = async (url, init) => {
    assert.match(JSON.parse(init.body).input, /Answer the question/);
    return Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                ...answer,
                steps: [{ ...answer.steps[0], startLine: 2, endLine: 2 }],
              }),
            },
          ],
        },
      ],
    });
  };
  const response = await analyze(
    req({
      ...credentials,
      mode: 'file',
      question: 'What is returned?',
      file: { path: 'a.js', content: 'function one() {\nreturn 1;\n}' },
    }),
  );
  assert.equal(response.status, 200);
});
test('repository overview includes every file without requesting contents', async () => {
  global.fetch = async (url, init) => {
    assert.match(JSON.parse(init.body).input, /FILE OVERVIEW/);
    return Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                summary: 'Files.',
                steps: ['a.ts', 'logo.png'].map((path) => ({
                  title: path,
                  explanation: 'Likely role, inferred from the path.',
                  path,
                  startLine: 0,
                  endLine: 0,
                })),
              }),
            },
          ],
        },
      ],
    });
  };
  const response = await analyze(
    req({
      ...credentials,
      mode: 'repository',
      files: [{ path: 'a.ts' }, { path: 'logo.png' }],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).steps.length, 2);
});
test('request validation rejects oversized, cross-origin, unsupported-provider and binary inputs', async () => {
  global.fetch = () => {
    throw new Error('Must not call provider');
  };
  assert.equal(
    (await models(req({ ...credentials, provider: 'evil' }))).status,
    400,
  );
  assert.equal(
    (await models(req(credentials, { Origin: 'https://evil.example' }))).status,
    403,
  );
  assert.equal(
    (
      await analyze(
        req({
          ...credentials,
          mode: 'file',
          file: { path: 'x', content: 'a\0b' },
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await analyze(
        req({
          ...credentials,
          mode: 'file',
          file: { path: 'x', content: 'x'.repeat(400001) },
        }),
      )
    ).status,
    413,
  );
  assert.equal(
    (await repository(req({ action: 'tree', url: 'https://evil.example/a/b' })))
      .status,
    400,
  );
});
test('provider errors never echo raw credential-bearing response bodies', async () => {
  global.fetch = async () =>
    new Response('raw test-secret credential', { status: 401 });
  const response = await models(req(credentials));
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /test-secret/);
});
test('repository import pins blobs, includes assets, and rejects truncated trees', async () => {
  const sha = 'a'.repeat(40);
  let calls = 0;
  global.fetch = async () =>
    Response.json(
      ++calls === 1
        ? { default_branch: 'main', private: false }
        : {
            sha,
            truncated: false,
            tree: [
              { type: 'blob', path: 'a.ts', sha, size: 3 },
              { type: 'blob', path: 'image.png', sha, size: 3 },
              { type: 'tree', path: 'dir', sha },
            ],
          },
    );
  const tree = await repositoryTree('github.com/owner/repo');
  assert.equal(tree.files.length, 2);
  assert.equal(tree.repo.ref, sha);
  global.fetch = async (url) => {
    assert.match(url, new RegExp(`/git/blobs/${sha}$`));
    return Response.json({ size: 3, encoding: 'base64', content: btoa('abc') });
  };
  assert.deepEqual(await repositoryFile(tree.repo, 'a.ts', sha), {
    content: 'abc',
  });
  calls = 0;
  global.fetch = async () =>
    Response.json(
      ++calls === 1
        ? { default_branch: 'main', private: false }
        : { sha, truncated: true, tree: [] },
    );
  await assert.rejects(repositoryTree('github.com/owner/repo'), /truncated/);
});
test('truncated model responses are rejected instead of shown as complete', async () => {
  global.fetch = async () =>
    Response.json({ status: 'incomplete', output: [] });
  await assert.rejects(
    generate('openai', 'secret', 'gpt-test', 'prompt'),
    /output cap/,
  );
});

test('oversized upstream payloads are stopped before parsing', async () => {
  const sha = 'a'.repeat(40);
  global.fetch = async () => new Response('x'.repeat(200001));
  await assert.rejects(
    repositoryFile({ owner: 'owner', name: 'repo', ref: sha }, 'file.ts', sha),
    /size limit/,
  );
});

test('outbound requests use Worker-compatible manual redirects and never follow a credential redirect', async () => {
  global.fetch = async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(init.cache, 'no-store');
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://untrusted.example' },
    });
  };
  await assert.rejects(
    listModels('openai', 'secret'),
    /Provider request failed/,
  );
});

test('OpenRouter prefix is detected without sending the key to OpenAI', () => {
  assert.equal(detectProvider('sk-or-v1-example'), 'openrouter');
});

test('OpenRouter authenticates before listing account-filtered text models', async () => {
  const urls = [];
  global.fetch = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer sk-or-v1-test');
    if (url.endsWith('/key')) return Response.json({ data: { label: 'test' } });
    return Response.json({
      data: [
        {
          id: 'vendor/model:free',
          name: 'Free text',
          architecture: {
            input_modalities: ['text'],
            output_modalities: ['text'],
          },
        },
        {
          id: 'vendor/vision',
          name: 'Vision and text',
          architecture: {
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        },
        {
          id: 'vendor/image',
          name: 'Image',
          architecture: {
            input_modalities: ['text'],
            output_modalities: ['image'],
          },
        },
        {
          id: 'vendor/audio',
          name: 'Audio input',
          architecture: {
            input_modalities: ['audio'],
            output_modalities: ['text'],
          },
        },
      ],
    });
  };
  const response = await models(
    req({ provider: 'openrouter', key: 'sk-or-v1-test' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).models.map((m) => m.id),
    ['vendor/model:free', 'vendor/vision'],
  );
  assert.deepEqual(urls, [
    'https://openrouter.ai/api/v1/key',
    'https://openrouter.ai/api/v1/models/user',
  ]);
});

test('OpenRouter rejects an invalid key before fetching its model catalog', async () => {
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/key');
    return new Response('private secret', { status: 401 });
  };
  const response = await models(
    req({ provider: 'openrouter', key: 'sk-or-v1-invalid' }),
  );
  assert.equal(response.status, 401);
  assert.equal(calls, 1);
  assert.doesNotMatch(await response.text(), /private secret/);
});

test('OpenRouter file analysis accepts namespaced free-model IDs and parses chat completions', async () => {
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    const payload = JSON.parse(init.body);
    assert.equal(payload.model, 'vendor/model-v1.2:free');
    assert.equal(payload.stream, false);
    assert.match(payload.messages[0].content, /Explain ALL lines/);
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: JSON.stringify(answer) } },
      ],
    });
  };
  const response = await analyze(
    req({
      ...credentials,
      provider: 'openrouter',
      model: 'vendor/model-v1.2:free',
      mode: 'file',
      file: { path: 'a.js', content: 'function one() {\nreturn 1;\n}' },
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual({ summary: result.summary, steps: result.steps }, answer);
  assert.equal(result.usage.length, 1);
  assert.equal(typeof result.requestId, 'string');
});

test('OpenRouter rejects incomplete and embedded-error responses and reports credit failures safely', async () => {
  for (const response of [
    { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    {
      choices: [
        { finish_reason: 'content_filter', message: { content: 'partial' } },
      ],
    },
    { error: { code: 502, message: 'raw private content' } },
    {
      choices: [
        {
          finish_reason: 'stop',
          error: { code: 502 },
          message: { content: 'partial' },
        },
      ],
    },
  ]) {
    global.fetch = async () => Response.json(response);
    await assert.rejects(
      generate('openrouter', 'secret', 'vendor/model', 'prompt'),
    );
  }
  global.fetch = async () =>
    new Response('raw private credit error', { status: 402 });
  await assert.rejects(
    generate('openrouter', 'secret', 'vendor/model', 'prompt'),
    /credits are insufficient/,
  );
});

test('provider usage normalization includes caches and reasoning without double-counting', async () => {
  const { normalizeUsage } = await import('../.test-build/lib/usage.js');
  const openai = normalizeUsage(
    'openai',
    'm',
    {
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        total_tokens: 140,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens_details: { reasoning_tokens: 10 },
      },
    },
    {
      contextWindow: 1000,
      pricing: { input: 0.000002, output: 0.000006, cachedInput: 0.000001 },
    },
    500,
    'completed',
  );
  assert.equal(openai.totalTokens, 140);
  assert.equal(openai.availableTokens, 860);
  assert.equal(openai.reasoningTokens, 10);
  assert.ok(Math.abs(openai.costUsd - 0.00042) < 1e-10);
  const claude = normalizeUsage(
    'anthropic',
    'm',
    {
      usage: {
        input_tokens: 50,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 20,
        output_tokens: 10,
      },
    },
    { inputLimit: 200 },
    100,
    'end_turn',
  );
  assert.equal(claude.inputTokens, 100);
  assert.equal(claude.totalTokens, 110);
  assert.equal(claude.availableTokens, 100);
  assert.equal(claude.capacityKind, 'input');
  const gemini = normalizeUsage(
    'gemini',
    'm',
    {
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 20,
        totalTokenCount: 150,
        cachedContentTokenCount: 10,
      },
    },
    { inputLimit: 1000 },
    500,
    'STOP',
  );
  assert.equal(gemini.outputTokens, 50);
  assert.equal(gemini.totalTokens, 150);
  assert.equal(gemini.availableTokens, 900);
});

test('reported zero cost stays zero while missing prices and counts stay unknown', async () => {
  const { normalizeUsage, usageTotals } =
    await import('../.test-build/lib/usage.js');
  const free = normalizeUsage(
    'openrouter',
    'm',
    {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        cost: 0,
      },
    },
    {},
    100,
    'stop',
  );
  const unknown = normalizeUsage('openrouter', 'm', {}, {}, 100, 'stop');
  assert.equal(free.costUsd, 0);
  assert.equal(free.costSource, 'reported');
  assert.equal(unknown.costUsd, null);
  assert.equal(unknown.totalTokens, null);
  assert.equal(usageTotals([free, unknown]).costUsd, null);
  assert.equal(usageTotals([free, free]).totalTokens, 30);
});

test('OpenRouter discovery preserves live limits and prices including free prices', async () => {
  global.fetch = async (url) =>
    Response.json(
      url.endsWith('/key')
        ? { data: {} }
        : {
            data: [
              {
                id: 'vendor/free',
                name: 'Free',
                architecture: {
                  input_modalities: ['text'],
                  output_modalities: ['text'],
                },
                context_length: 16000,
                top_provider: { max_completion_tokens: 2048 },
                pricing: { prompt: '0', completion: '0' },
              },
            ],
          },
    );
  const result = await listModels('openrouter', 'secret');
  assert.equal(result[0].contextWindow, 16000);
  assert.equal(result[0].outputLimit, 2048);
  assert.deepEqual(result[0].pricing, { input: 0, output: 0 });
});

test('generation respects model output limits and reports usage even when output is truncated', async () => {
  const records = [];
  global.fetch = async (url, init) => {
    assert.equal(JSON.parse(init.body).max_tokens, 2048);
    return Response.json({
      choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 2048,
        total_tokens: 2148,
        cost: 0.02,
      },
    });
  };
  await assert.rejects(
    generate('openrouter', 'secret', 'vendor/model', 'prompt', undefined, {
      metadata: { contextWindow: 16000, outputLimit: 2048 },
      onUsage: (u) => records.push(u),
    }),
    (e) => e.code === 'output_limit',
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].costUsd, 0.02);
  assert.equal(records[0].outputTokens, 2048);
});

test('repository introduction uses the requested prompt and supplied source evidence', async () => {
  global.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    assert.match(
      prompt,
      /read and understand this repo\/app\. describe it in clear terms, what it does, what it is\./,
    );
    assert.match(prompt, /This app tracks bicycles/);
    assert.match(prompt, /bounded sample/);
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              summary: 'A bicycle tracking application.',
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        cost: 0.001,
      },
    });
  };
  const response = await analyze(
    req({
      ...credentials,
      provider: 'openrouter',
      model: 'vendor/model',
      mode: 'intro',
      paths: ['README.md', 'app.ts'],
      sources: [{ path: 'README.md', content: 'This app tracks bicycles.' }],
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.summary, 'A bicycle tracking application.');
  assert.deepEqual(result.sources, ['README.md']);
  assert.equal(result.omittedFiles, 1);
  assert.equal(result.usage[0].costUsd, 0.001);
});

test('intro source selection prioritizes docs and entry points and omits secret files', async () => {
  const { selectIntroFiles } = await import('../.test-build/lib/intro.js');
  const files = [
    '.env',
    'secrets.json',
    'README.md',
    'package.json',
    'src/main.ts',
    'docs/guide.md',
    'src/helper.ts',
    'dist/index.js',
  ].map((path) => ({ path, size: 100 }));
  assert.deepEqual(
    selectIntroFiles(files).map((f) => f.path),
    [
      'README.md',
      'package.json',
      'src/main.ts',
      'docs/guide.md',
      'src/helper.ts',
    ],
  );
});

test('intro rejects unlisted source paths without contacting a provider', async () => {
  global.fetch = () => {
    throw new Error('Must not call');
  };
  const response = await analyze(
    req({
      ...credentials,
      mode: 'intro',
      paths: ['a'],
      sources: [{ path: 'outside', content: 'data' }],
    }),
  );
  assert.equal(response.status, 400);
});

test('analysis failure preserves usage and logs a diagnosis without source or API key', async () => {
  const lines = [];
  console.info = (s) => lines.push(s);
  console.error = (s) => lines.push(s);
  global.fetch = async () =>
    Response.json({
      choices: [
        { finish_reason: 'length', message: { content: 'PRIVATE-SOURCE' } },
      ],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 2048,
        total_tokens: 2171,
        cost: 0.02,
      },
    });
  const response = await analyze(
    req({
      ...credentials,
      key: 'PRIVATE-KEY',
      provider: 'openrouter',
      model: 'vendor/model',
      mode: 'file',
      modelInfo: { outputLimit: 2048 },
      file: { path: 'PRIVATE-PATH', content: 'PRIVATE-SOURCE' },
    }),
  );
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.code, 'output_limit');
  assert.equal(result.usage[0].costUsd, 0.02);
  const log = lines.join('\n');
  assert.match(log, /analysis_failed/);
  assert.match(log, /output_limit/);
  assert.doesNotMatch(log, /PRIVATE-KEY|PRIVATE-SOURCE|PRIVATE-PATH/);
});

test('upstream context-limit errors are classified without echoing raw error text', async () => {
  global.fetch = async () =>
    Response.json(
      {
        error: {
          code: 'context_length_exceeded',
          message: 'PRIVATE-SOURCE is too long',
        },
      },
      { status: 400 },
    );
  const response = await analyze(
    req({ ...credentials, mode: 'file', file: { path: 'a', content: 'code' } }),
  );
  const result = await response.json();
  assert.equal(response.status, 422);
  assert.equal(result.code, 'context_limit');
  assert.doesNotMatch(result.error, /PRIVATE-SOURCE/);
});

test('multi-section completed analyses retain usage from every request', async () => {
  global.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).input;
    const match = prompt.match(/section (\d+)–(\d+) of/);
    assert.ok(match);
    return Response.json({
      status: 'completed',
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                summary: 'Section.',
                steps: [
                  {
                    title: 'Section',
                    explanation: 'Code.',
                    startLine: Number(match[1]),
                    endLine: Number(match[2]),
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  };
  const response = await analyze(
    req({
      ...credentials,
      mode: 'file',
      file: {
        path: 'a',
        content: Array.from({ length: 300 }, () => 'const x = 1;').join('\n'),
      },
    }),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.usage.length, 3);
  assert.equal(result.steps.at(-1).endLine, 300);
});

test('provider deadlines produce a distinct timeout diagnosis', async () => {
  const { upstream } = await import('../.test-build/lib/server.js');
  global.fetch = async (url, init) =>
    new Promise((resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason), {
        once: true,
      }),
    );
  const keepAlive = setInterval(() => {}, 20);
  try {
    await assert.rejects(
      upstream('https://example.test', {}, undefined, 5),
      (e) => e.code === 'timeout' && e.status === 504,
    );
  } finally {
    clearInterval(keepAlive);
  }
});

test('unknown model metadata remains unknown and invalid overrides are discarded', async () => {
  const { sanitizeModelInfo } = await import('../.test-build/lib/usage.js');
  assert.deepEqual(
    sanitizeModelInfo({
      contextWindow: -1,
      inputLimit: NaN,
      outputLimit: Infinity,
      pricing: { input: -2, output: 1 },
    }),
    {},
  );
  assert.deepEqual(
    sanitizeModelInfo({
      contextWindow: 32000,
      outputLimit: 2048,
      pricing: { input: 0, output: 0 },
    }),
    {
      contextWindow: 32000,
      outputLimit: 2048,
      pricing: { input: 0, output: 0 },
    },
  );
});

test('invalid walkthrough structure retains returned usage for cost reporting', async () => {
  global.fetch = async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        cost: 0.001,
      },
    });
  const response = await analyze(
    req({
      ...credentials,
      provider: 'openrouter',
      model: 'vendor/model',
      mode: 'file',
      file: { path: 'a', content: 'code' },
    }),
  );
  const result = await response.json();
  assert.equal(response.status, 422);
  assert.equal(result.code, 'invalid_response');
  assert.equal(result.usage[0].costUsd, 0.001);
});
