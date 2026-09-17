import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startLocalService } from '../apps/bridge/src/server.js';
import { makeFixture } from '../packages/contracts/src/pixels.js';

async function json(url: string, token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(url + path, {
    ...init,
    headers: { authorization: 'Bearer ' + token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) }
  });
  return { status: response.status, body: await response.json(), response };
}

async function waitJob(url: string, token: string, id: string): Promise<any> {
  let latest: any;
  for (let i = 0; i < 50; i++) {
    latest = (await json(url, token, '/v1/jobs/' + id)).body;
    if (latest && latest.status !== 'queued' && latest.status !== 'in_progress') return latest;
    await delay(20);
  }
  throw new Error('job did not finish: ' + (latest?.status ?? 'missing'));
}

test('mock jobs, candidates, cancel, idempotency and budget', async t => {
  const bridge = await startLocalService({ port: 0, slowMs: 80, lateMs: 80 });
  t.after(() => bridge.close());
  const fixture = makeFixture();
  const token = bridge.token;

  await t.test('health handshake does not disclose token', async () => {
    const { status, body } = await json(bridge.url, token, '/v1/health');
    assert.equal(status, 200);
    assert.equal(body.protocolVersion, 'photoshop-ai/0.1');
    assert.equal(body.remoteGenerationEnabled, false);
    assert.ok(!JSON.stringify(body).includes(token));
  });

  await t.test('layer edit produces exact-size candidate without writing a host document', async () => {
    const created = await json(bridge.url, token, '/v1/assets', { method: 'POST', body: JSON.stringify({ width: fixture.width, height: fixture.height, byteLength: fixture.pixels.byteLength, kind: 'source' }) });
    const raw = await fetch(bridge.url + '/v1/assets/' + created.body.id + '/raw', {
      method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream' }, body: Buffer.from(fixture.pixels)
    });
    assert.equal(raw.status, 200);
    const job = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-layer-1', mode: 'layer', model: 'mock-edit', prompt: '换成暖橙色',
      sourceAssetId: created.body.id, alphaPolicy: 'preserve-source', n: 1, options: { mockMode: 'invert' }
    }) });
    assert.equal(job.status, 202);
    const latest = await waitJob(bridge.url, token, job.body.id);
    assert.equal(latest.status, 'completed');
    assert.equal(latest.candidates.length, 1);
    assert.equal(latest.candidates[0].width, fixture.width);
    assert.equal(latest.candidates[0].height, fixture.height);
  });

  await t.test('text job does not require source and multi returns four candidates', async () => {
    const job = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-text-1', mode: 'text', model: 'mock-multi', prompt: '蓝色方块',
      alphaPolicy: 'use-model', n: 1, options: { mockMode: 'multi', size: '64x64' }
    }) });
    const latest = await waitJob(bridge.url, token, job.body.id);
    assert.equal(latest.status, 'completed');
    assert.equal(latest.candidates.length, 4);
  });

  await t.test('idempotent create and conflicting payload', async () => {
    const payload = { clientRequestId: 'req-idemp', mode: 'text', model: 'mock-text', prompt: 'same', alphaPolicy: 'use-model', n: 1, options: { mockMode: 'text', size: '64x64' } };
    const a = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify(payload) });
    const b = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(a.body.id, b.body.id);
    const conflict = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({ ...payload, prompt: 'other' }) });
    assert.equal(conflict.status, 409);
    await waitJob(bridge.url, token, a.body.id);
  });

  await t.test('cancel prevents late success from becoming applicable', async () => {
    const job = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-late', mode: 'text', model: 'mock-late', prompt: 'late',
      alphaPolicy: 'use-model', n: 1, options: { mockMode: 'late', size: '64x64' }
    }) });
    const cancelled = await json(bridge.url, token, '/v1/jobs/' + job.body.id + '/cancel', { method: 'POST', body: '{}' });
    assert.equal(cancelled.body.status, 'cancelled');
    await delay(120);
    const later = (await json(bridge.url, token, '/v1/jobs/' + job.body.id)).body;
    assert.equal(later.status, 'cancelled');
    assert.equal(later.candidates.length, 0);
  });

  await t.test('unknown fields and geometry mismatch are rejected before apply', async () => {
    const created = await json(bridge.url, token, '/v1/assets', { method: 'POST', body: JSON.stringify({ width: fixture.width, height: fixture.height, byteLength: fixture.pixels.byteLength, kind: 'source' }) });
    await fetch(bridge.url + '/v1/assets/' + created.body.id + '/raw', {
      method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream' }, body: Buffer.from(fixture.pixels)
    });
    const badField = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-field', mode: 'layer', model: 'mock-edit', prompt: 'x',
      sourceAssetId: created.body.id, alphaPolicy: 'preserve-source', n: 1, options: { mockMode: 'invert', background: 'transparent' }
    }) });
    assert.equal(badField.status, 400);
    assert.equal(badField.body.error.code, 'FIELD_NOT_ALLOWED');
    const geo = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-geo', mode: 'layer', model: 'mock-geometry', prompt: 'x',
      sourceAssetId: created.body.id, alphaPolicy: 'preserve-source', n: 1, options: { mockMode: 'geometry' }
    }) });
    const latest = await waitJob(bridge.url, token, geo.body.id);
    assert.equal(latest.status, 'failed');
    assert.equal(latest.error.code, 'OUTPUT_GEOMETRY_MISMATCH');
  });

  await t.test('second job is busy while a slow job is active', async () => {
    const slow = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-slow', mode: 'text', model: 'mock-slow', prompt: 'slow',
      alphaPolicy: 'use-model', n: 1, options: { mockMode: 'slow', size: '64x64' }
    }) });
    const second = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-busy', mode: 'text', model: 'mock-text', prompt: 'other',
      alphaPolicy: 'use-model', n: 1, options: { mockMode: 'text', size: '64x64' }
    }) });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'BUSY');
    await waitJob(bridge.url, token, slow.body.id);
  });

  await t.test('cangyuan live path is blocked without verified RMB cost', async () => {
    await json(bridge.url, token, '/v1/provider-config', { method: 'PUT', body: JSON.stringify({ provider: 'cangyuan', apiKey: 'sk-test-not-real' }) });
    const denied = await json(bridge.url, token, '/v1/jobs', { method: 'POST', body: JSON.stringify({
      clientRequestId: 'req-live', mode: 'text', model: 'grok-imagine-image-lite', prompt: 'x',
      alphaPolicy: 'use-model', n: 1, options: {}
    }) });
    assert.equal(denied.status, 402);
    assert.equal(denied.body.error.code, 'COST_UNKNOWN');
    const cfg = (await json(bridge.url, token, '/v1/provider-config')).body;
    assert.equal(cfg.hasApiKey, true);
    assert.equal(cfg.liveImageVerified, false);
    assert.equal(cfg.sourceUploadVerified, false);
    assert.ok(!JSON.stringify(cfg).includes('sk-test-not-real'));
  });
});
