import { inflateSync, deflateSync } from 'node:zlib';
import { COLOR_PROFILE } from '../../contracts/src/pixels.js';
import { AppError } from '../../contracts/src/errors.js';

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

export function encodePngRgba(width: number, height: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export function decodePngRgbaIndependent(buffer: Buffer): { width: number; height: number; pixels: Uint8Array; colorProfile: typeof COLOR_PROFILE } {
  if (buffer.length < 24 || buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) {
    throw new AppError(400, 'INVALID_IMAGE', '不是有效的 PNG。');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let sawIend = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const frame = buffer.subarray(offset + 4, offset + 8 + length);
    const expected = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(frame) !== expected) throw new AppError(400, 'INVALID_IMAGE', 'PNG 校验失败。');
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'acTL') throw new AppError(400, 'ANIMATED_IMAGE', '不接受动画图像。');
    else if (type === 'IEND') { sawIend = true; break; }
    offset += 12 + length;
  }
  if (!sawIend || bitDepth !== 8 || colorType !== 6 || width < 1 || height < 1) {
    throw new AppError(400, 'INVALID_IMAGE', '仅接受 8 位 RGBA PNG。');
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src]!;
    src += 1;
    const row = inflated.subarray(src, src + stride);
    src += stride;
    if (filter === 0) pixels.set(row, y * stride);
    else if (filter === 1) {
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? pixels[y * stride + i - 4]! : 0;
        pixels[y * stride + i] = (row[i]! + left) & 255;
      }
    } else if (filter === 2) {
      for (let i = 0; i < stride; i++) {
        const up = y === 0 ? 0 : pixels[(y - 1) * stride + i]!;
        pixels[y * stride + i] = (row[i]! + up) & 255;
      }
    } else {
      throw new AppError(400, 'INVALID_IMAGE', '不支持的 PNG 过滤类型。');
    }
  }
  return { width, height, pixels, colorProfile: COLOR_PROFILE };
}
