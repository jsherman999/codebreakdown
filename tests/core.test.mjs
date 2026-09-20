import { test, afterEach } from 'node:test';
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
afterEach(() => {
  global.fetch = nativeFetch;
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
  assert.deepEqual(await response.json(), answer);
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
    /output space/,
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
