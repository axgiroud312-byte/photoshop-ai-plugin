import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startLocalService } from '../apps/bridge/src/server.js';
import { isBlockedIp, assertSafeHttpsUrl } from '../apps/bridge/src/download.js';

test('http security and ssrf guards', async t => {
  const bridge = await startLocalService({ port: 0 });
  t.after(() => bridge.close());

  await t.test('missing origin and uxp origin are allowed', async () => {
    const ok = await fetch(bridge.url + '/v1/health', {
      headers: { authorization: 'Bearer ' + bridge.token, origin: 'uxp://photoshop' }
    });
    assert.equal(ok.status, 200);
    const plugin = await fetch(bridge.url + '/v1/health', {
      headers: { authorization: 'Bearer ' + bridge.token, origin: 'plugin://com.axgiroud312.photoshop-ai' }
    });
    assert.equal(plugin.status, 200);
  });

  await t.test('wrong host and web origin are rejected', async () => {
    for (const extra of [{ origin: 'https://example.com' }, { host: 'attacker.invalid' }]) {
      await new Promise<void>((resolve, reject) => {
        const req = request(bridge.url + '/v1/health', {
          headers: { authorization: 'Bearer ' + bridge.token, ...extra }
        }, response => {
          response.resume();
          response.on('end', () => {
            try { assert.equal(response.statusCode, 403); resolve(); } catch (error) { reject(error); }
          });
        });
        req.on('error', reject);
        req.end();
      });
    }
  });

  await t.test('private addresses cannot be downloaded', async () => {
    assert.equal(isBlockedIp('127.0.0.1'), true);
    assert.equal(isBlockedIp('10.0.0.1'), true);
    assert.equal(isBlockedIp('192.168.1.1'), true);
    assert.equal(isBlockedIp('169.254.169.254'), true);
    await assert.rejects(() => assertSafeHttpsUrl('http://example.com/a.png'));
    await assert.rejects(() => assertSafeHttpsUrl('https://127.0.0.1/a.png'));
  });
});
