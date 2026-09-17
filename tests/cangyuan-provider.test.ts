import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CangyuanProvider } from '../apps/bridge/src/providers/cangyuan.js';
import { AssetStore } from '../packages/image/src/store.js';
import { encodePngRgba } from '../packages/image/src/png.js';
import { mockModels } from '../packages/catalog/src/adapt.js';
import { AppError } from '../packages/contracts/src/errors.js';

test('cangyuan provider uses JSON HTTPS contract and polls the original path once', async () => {
  const store = new AssetStore();
  const png = encodePngRgba(2, 2, new Uint8Array(16).fill(255));
  let posts = 0;
  let polls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'POST') {
      posts++;
      const body = JSON.parse(String(init?.body ?? '{}')) as { async?: boolean; model?: string };
      assert.equal(body.async, true);
      assert.equal(url.endsWith('/v1/images/generations'), true);
      assert.ok(!url.includes('/v1/v1/'));
      return new Response(JSON.stringify({ id: 'task_1', status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    polls++;
    assert.equal(url.endsWith('/v1/images/generations/task_1'), true);
    return new Response(JSON.stringify({
      id: 'task_1', status: 'completed',
      data: [{ b64_json: png.toString('base64') }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = new CangyuanProvider(store, {
    baseUrl: 'https://direct-api.cangyuansuanli.cn',
    apiKey: 'sk-test',
    sourceUploadVerified: false,
    fetchImpl
  });
  const model = mockModels('now').find(item => item.id === 'mock-text')!;
  const handle = await provider.submit({
    jobId: 'job_1', clientRequestId: 'c1', mode: 'text', model, prompt: 'blue square',
    alphaPolicy: 'use-model', n: 1, options: {}, signal: new AbortController().signal
  });
  assert.equal(handle.providerTaskId, 'task_1');
  assert.equal(handle.submitPath, '/v1/images/generations');
  const result = await provider.poll({
    jobId: 'job_1', clientRequestId: 'c1', mode: 'text', model, prompt: 'blue square',
    alphaPolicy: 'use-model', n: 1, options: {}, signal: new AbortController().signal
  }, handle);
  assert.equal(result.status, 'completed');
  assert.equal(result.candidates.length, 1);
  assert.equal(posts, 1);
  assert.equal(polls, 1);

  await assert.rejects(() => provider.submit({
    jobId: 'job_2', clientRequestId: 'c2', mode: 'layer', model: mockModels('now')[0]!, prompt: 'edit',
    alphaPolicy: 'preserve-source', n: 1, options: {}, signal: new AbortController().signal
  }), (error: AppError) => error.code === 'SOURCE_UPLOAD_UNVERIFIED');
});
