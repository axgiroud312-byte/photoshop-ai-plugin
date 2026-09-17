import { sha256Hex } from './sha256.js';

export const MAX_EDGE = 8192;
export const MAX_PIXELS = 16_777_216;
export const CHANNELS = 4;
export const COLOR_PROFILE = 'sRGB IEC61966-2.1';

export function rgbaLength(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE ||
      width * height > MAX_PIXELS) {
    throw new RangeError('图像尺寸超出本版本限制。');
  }
  return width * height * CHANNELS;
}

export interface RgbaFixture {
  width: number;
  height: number;
  channels: 4;
  componentSize: 8;
  colorProfile: typeof COLOR_PROFILE;
  pixels: Uint8Array;
}

// Deterministic engineering input, not AI-generated artwork.
export function makeFixture(width = 67, height = 43): RgbaFixture {
  const pixels = new Uint8Array(rgbaLength(width, height));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      pixels[i] = light ? 242 : 39;
      pixels[i + 1] = (x * 7 + y * 3) % 256;
      pixels[i + 2] = light ? 64 : 210;
      const hole = x > width / 3 && x < width * 2 / 3 &&
        y > height / 3 && y < height * 2 / 3;
      pixels[i + 3] = hole ? 0 : (x % 11 === 3 ? 127 : 255);
    }
  }
  return { width, height, channels: 4, componentSize: 8,
    colorProfile: COLOR_PROFILE, pixels };
}

export function canonicalRgba(pixels: Uint8Array): Uint8Array {
  if (pixels.byteLength % 4 !== 0) throw new RangeError('RGBA 长度必须是 4 的倍数。');
  const result = pixels.slice();
  for (let i = 0; i < result.length; i += 4) {
    if (result[i + 3] === 0) result.fill(0, i, i + 3);
  }
  return result;
}

export function pixelSha256(pixels: Uint8Array): string {
  return sha256Hex(pixels);
}

export function canonicalSha256(pixels: Uint8Array): string {
  return pixelSha256(canonicalRgba(pixels));
}

export function premultiplyStraight(pixels: Uint8Array): Uint8Array {
  const out = pixels.slice();
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]! / 255;
    out[i] = Math.round(out[i]! * a);
    out[i + 1] = Math.round(out[i + 1]! * a);
    out[i + 2] = Math.round(out[i + 2]! * a);
  }
  return out;
}

export function unpremultiplyToStraight(pixels: Uint8Array): Uint8Array {
  const out = pixels.slice();
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]!;
    if (a === 0) {
      out.fill(0, i, i + 3);
      continue;
    }
    if (a === 255) continue;
    const inv = 255 / a;
    out[i] = Math.min(255, Math.round(out[i]! * inv));
    out[i + 1] = Math.min(255, Math.round(out[i + 1]! * inv));
    out[i + 2] = Math.min(255, Math.round(out[i + 2]! * inv));
  }
  return out;
}
