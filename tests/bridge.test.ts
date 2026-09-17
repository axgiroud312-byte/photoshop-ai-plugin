import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { startMockBridge } from '../apps/bridge/src/server.js';
import { makeFixture, rgbaLength, canonicalRgba } from '../packages/contracts/src/pixels.js';

const fixture = makeFixture();
function inputHeaders(token: string, width = fixture.width, height = fixture.height) {
  return { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream',
    'x-image-width': String(width), 'x-image-height': String(height) };
}

test('local bridge contract and cancellation boundaries', async t => {
  const bridge = await startMockBridge({ port: 0, slowMs: 150, lateMs: 150 });
  t.after(() => bridge.close());

  await t.test('health requires pairing and does not disclose token', async () => {
    const rejected = await fetch(bridge.url + '/v1/health');
    assert.equal(rejected.status, 401);
    const response = await fetch(bridge.url + '/v1/health', {
      headers: { authorization: 'Bearer ' + bridge.token }
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(!body.includes(bridge.token));
    assert.equal(JSON.parse(body).remoteGenerationEnabled, false);
  });

  await t.test('origin and wrong host are rejected even with a valid token', async () => {
    for (const extra of [{ origin: 'https://example.com' }, { host: 'attacker.invalid' }]) {
      // fetch normalizes Host; use HTTP directly to exercise the actual hostile header.
      await new Promise<void>((resolve, reject) => {
        const req = request(bridge.url + '/v1/health', {
          headers: { authorization: 'Bearer ' + bridge.token, ...extra }
        }, response => {
          response.resume();
          response.on('error', reject);
          response.on('end', () => {
            try {
              assert.equal(response.statusCode, 403);
              assert.equal(response.headers['access-control-allow-origin'], undefined);
              resolve();
            } catch (error) { reject(error); }
          });
        });
        req.on('error', reject);
        req.end();
      });
    }
  });

  await t.test('RGBA survives exact binary roundtrip including hidden RGB and alpha', async () => {
    const original = fixture.pixels.slice();
    const response = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), original);
    assert.deepEqual(fixture.pixels, original);
    assert.equal(response.headers.get('x-pixel-sha256'),
      createHash('sha256').update(original).digest('hex'));
    assert.equal(response.headers.get('x-image-width'), String(fixture.width));
  });

  await t.test('visible transform preserves every alpha byte', async () => {
    const response = await fetch(bridge.url + '/v1/mock/roundtrip?mode=invert', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(response.status, 200);
    const output = new Uint8Array(await response.arrayBuffer());
    for (let i = 0; i < output.length; i += 4) {
      assert.equal(output[i], 255 - fixture.pixels[i]!);
      assert.equal(output[i + 3], fixture.pixels[i + 3]);
    }
  });

  await t.test('wrong byte length and excessive dimensions fail before processing', async () => {
    const short = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: inputHeaders(bridge.token, 2, 2), body: Buffer.alloc(15)
    });
    assert.equal(short.status, 400);
    const oversized = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: inputHeaders(bridge.token, 8193, 2), body: Buffer.alloc(16)
    });
    assert.equal(oversized.status, 413);
  });

  await t.test('unsupported mode and JSON are not accepted as raw pixels', async () => {
    const mode = await fetch(bridge.url + '/v1/mock/roundtrip?mode=unknown', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(mode.status, 400);
    const json = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: { ...inputHeaders(bridge.token),
        'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(json.status, 415);
  });

  await t.test('fixed provider failure is explicit and does not become a success', async () => {
    const response = await fetch(bridge.url + '/v1/mock/roundtrip?mode=failure', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'MOCK_FAILURE');
  });

  async function waitActive() {
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await fetch(bridge.url + '/v1/health', {
        headers: { authorization: 'Bearer ' + bridge.token }
      });
      if ((await response.json()).activeRequests === 1) return;
      await delay(5);
    }
    assert.fail('Slow request never became active.');
  }

  await t.test('single concurrency rejects a second request, then frees the slot', async () => {
    const first = fetch(bridge.url + '/v1/mock/roundtrip?mode=slow', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    await waitActive();
    const second = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(second.status, 409);
    assert.equal((await first).status, 200);
  });

  await t.test('cancelled slow request cannot complete', async () => {
    const before = bridge.stats.completed;
    const controller = new AbortController();
    const pending = fetch(bridge.url + '/v1/mock/roundtrip?mode=slow', {
      method: 'POST', headers: inputHeaders(bridge.token),
      body: Buffer.from(fixture.pixels), signal: controller.signal
    });
    const rejection = assert.rejects(pending, { name: 'AbortError' });
    await waitActive();
    controller.abort();
    await rejection;
    await delay(30);
    assert.equal(bridge.stats.completed, before);
  });

  await t.test('provider response arriving after cancellation is discarded', async () => {
    const before = bridge.stats.completed;
    const controller = new AbortController();
    const pending = fetch(bridge.url + '/v1/mock/roundtrip?mode=late', {
      method: 'POST', headers: inputHeaders(bridge.token),
      body: Buffer.from(fixture.pixels), signal: controller.signal
    });
    const rejection = assert.rejects(pending, { name: 'AbortError' });
    await waitActive();
    controller.abort();
    await rejection;
    await delay(180);
    assert.equal(bridge.stats.completed, before);
    assert.ok(bridge.stats.cancelled >= 2);
    const recovered = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(recovered.status, 200);
  });
});

test('twenty mock roundtrips stay byte-identical and free the slot', async () => {
  const bridge = await startMockBridge({ port: 0 });
  const original = fixture.pixels.slice();
  for (let i = 0; i < 20; i++) {
    const response = await fetch(bridge.url + '/v1/mock/roundtrip', {
      method: 'POST', headers: inputHeaders(bridge.token), body: Buffer.from(fixture.pixels)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), original);
  }
  const health = await fetch(bridge.url + '/v1/health', { headers: { authorization: 'Bearer ' + bridge.token } });
  assert.equal((await health.json()).activeRequests, 0);
  await bridge.close();
});

test('pixel validation and canonical hash preserve visible data', () => {
  assert.throws(() => rgbaLength(0, 1));
  assert.throws(() => rgbaLength(8192, 8192));
  assert.throws(() => rgbaLength(2.5, 3));
  const input = new Uint8Array([1, 2, 3, 0, 4, 5, 6, 127]);
  assert.deepEqual(canonicalRgba(input), new Uint8Array([0, 0, 0, 0, 4, 5, 6, 127]));
  assert.deepEqual(input, new Uint8Array([1, 2, 3, 0, 4, 5, 6, 127]));
  assert.throws(() => canonicalRgba(new Uint8Array(3)));
});
