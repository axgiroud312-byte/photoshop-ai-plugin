import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { makeFixture } from '../packages/contracts/src/pixels.js';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const tag = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, checksum]);
}
const fixture = makeFixture();
const header = Buffer.alloc(13);
header.writeUInt32BE(fixture.width, 0);
header.writeUInt32BE(fixture.height, 4);
header[8] = 8;
header[9] = 6;
const scanlines = Buffer.alloc((fixture.width * 4 + 1) * fixture.height);
for (let y = 0; y < fixture.height; y++) {
  scanlines.set(fixture.pixels.subarray(y * fixture.width * 4, (y + 1) * fixture.width * 4),
    y * (fixture.width * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('sRGB', Buffer.from([0])),
  chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
]);
const directory = resolve('.local/fixtures');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'rgba-checker.raw'), fixture.pixels);
await writeFile(resolve(directory, 'rgba-checker.png'), png);
const { pixels, ...metadata } = fixture;
await writeFile(resolve(directory, 'rgba-checker.json'), JSON.stringify({
  ...metadata, provenance: 'deterministic program-generated engineering fixture',
  byteLength: pixels.byteLength,
  sha256: createHash('sha256').update(pixels).digest('hex'),
  suggestedDocumentPosition: { left: 17, top: 23 }
}, null, 2));
console.log('已生成本地色块、透明洞和半透明边缘素材：.local/fixtures/rgba-checker.png');
