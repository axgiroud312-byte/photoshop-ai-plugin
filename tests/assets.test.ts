import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AssetStore, decodeEncoded } from '../packages/image/src/store.js';
import { applyAlphaPolicy } from '../packages/image/src/alpha.js';
import { mappingForReturn } from '../packages/image/src/geometry.js';
import { decodePngRgbaIndependent, encodePngRgba } from '../packages/image/src/png.js';
import { makeFixture, canonicalRgba, rgbaLength } from '../packages/contracts/src/pixels.js';
import { AppError } from '../packages/contracts/src/errors.js';

test('asset store roundtrip, alpha, geometry and limits', async t => {
  const store = new AssetStore();
  const fixture = makeFixture();

  await t.test('PNG encode/decode independent path matches canonical pixels', () => {
    const png = encodePngRgba(fixture.width, fixture.height, fixture.pixels);
    const decoded = decodePngRgbaIndependent(png);
    assert.equal(decoded.width, fixture.width);
    assert.deepEqual(canonicalRgba(decoded.pixels), canonicalRgba(fixture.pixels));
  });

  await t.test('preserve-source restores alpha and rejects transparent black in visible area', () => {
    const source = new Uint8Array([10, 20, 30, 200, 1, 2, 3, 0]);
    const model = new Uint8Array([40, 50, 60, 255, 9, 9, 9, 0]);
    const out = applyAlphaPolicy(source, model, 'preserve-source');
    assert.deepEqual(out, new Uint8Array([40, 50, 60, 200, 0, 0, 0, 0]));
    const missing = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    assert.throws(() => applyAlphaPolicy(source, missing, 'preserve-source'), (error: AppError) => error.code === 'MISSING_SOURCE_COLOR');
  });

  await t.test('geometry mismatch is explicit and does not stretch', () => {
    assert.throws(() => mappingForReturn(100, 50, 200, 100, 200, 180), (error: AppError) => error.code === 'OUTPUT_GEOMETRY_MISMATCH');
    const mapping = mappingForReturn(100, 50, 200, 100, 200, 100);
    assert.equal(mapping.sourceWidth, 100);
    assert.equal(mapping.contentRect.width, 200);
  });

  await t.test('normalize returns exact source size including non-zero origin metadata', () => {
    const source = store.putRgba(fixture.width, fixture.height, fixture.pixels, 'source');
    const requestW = 80, requestH = 80;
    const padded = store.padToRequest(source.id, requestW, requestH);
    const result = store.normalizeModelResult({
      sourceId: source.id,
      returned: { width: requestW, height: requestH, pixels: padded.pixels },
      requestWidth: requestW, requestHeight: requestH,
      alphaPolicy: 'preserve-source'
    });
    assert.equal(result.asset.width, fixture.width);
    assert.equal(result.asset.height, fixture.height);
  });

  await t.test('JPEG/WebP decode converts to sRGB RGBA and rejects animation', async () => {
    const jpeg = await sharp(Buffer.from(encodePngRgba(fixture.width, fixture.height, fixture.pixels)))
      .jpeg({ quality: 80 }).toBuffer();
    const decoded = await decodeEncoded(jpeg);
    assert.equal(decoded.width, fixture.width);
    const still = encodePngRgba(2, 2, new Uint8Array(16).fill(255));
    const actl = Buffer.from([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0]);
    const crc = Buffer.alloc(4);
    let c = 0xffffffff;
    const frame = actl.subarray(4);
    for (const byte of frame) {
      c ^= byte;
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    const animated = Buffer.concat([still.subarray(0, 33), actl, crc, still.subarray(33)]);
    await assert.rejects(() => decodeEncoded(animated), (error: AppError) => error.code === 'ANIMATED_IMAGE');
    await assert.rejects(() => decodeEncoded(Buffer.from([1, 2, 3, 4, 5])), (error: AppError) => error.code === 'INVALID_IMAGE');
  });

  await t.test('twenty put/release cycles reclaim memory', () => {
    const cyclic = new AssetStore();
    for (let i = 0; i < 20; i++) {
      const info = cyclic.putRgba(8, 8, new Uint8Array(256).fill(i & 255), 'source');
      cyclic.release(info.id);
    }
    assert.equal(cyclic.size, 0);
    assert.equal(cyclic.memoryBytes, 0);
  });

  await t.test('limits, double release and memory reclaim', () => {
    assert.throws(() => rgbaLength(8193, 2));
    const tiny = store.putRgba(1, 1, new Uint8Array([1, 2, 3, 255]), 'source');
    const before = store.size;
    store.release(tiny.id);
    store.release(tiny.id);
    assert.equal(store.size, before - 1);
    const tight = new AssetStore(() => Date.now(), 1, 16);
    tight.putRgba(2, 2, new Uint8Array(16).fill(9), 'source');
    assert.throws(() => tight.putRgba(2, 2, new Uint8Array(16).fill(8), 'source'), (error: AppError) => error.code === 'MEMORY_LIMIT');
  });
});
