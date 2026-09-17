import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  ASSET_TTL_MS, MAX_ASSET_BYTES, MAX_ENCODED_BYTES, MAX_STORE_BYTES, PREVIEW_MAX_EDGE,
  type AlphaPolicy, type AssetInfo, type GeometryMapping, type Rect
} from '../../contracts/src/application.js';
import { AppError } from '../../contracts/src/errors.js';
import {
  CHANNELS, canonicalRgba, canonicalSha256, pixelSha256,
  premultiplyStraight, rgbaLength, unpremultiplyToStraight
} from '../../contracts/src/pixels.js';
import { applyAlphaPolicy } from './alpha.js';
import { containFit, mappingForReturn } from './geometry.js';
import { decodePngRgbaIndependent, encodePngRgba } from './png.js';

export interface StoredAsset {
  info: AssetInfo;
  pixels: Uint8Array;
  createdAt: number;
  retain: number;
}

export class AssetStore {
  private readonly assets = new Map<string, StoredAsset>();
  private memory = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = ASSET_TTL_MS,
    private readonly memoryLimit = MAX_STORE_BYTES
  ) {}

  get memoryBytes(): number { return this.memory; }
  get size(): number { return this.assets.size; }

  putRgba(width: number, height: number, pixels: Uint8Array, kind: AssetInfo['kind'], id?: string): AssetInfo {
    const expected = rgbaLength(width, height);
    if (pixels.byteLength !== expected) throw new AppError(400, 'INVALID_LENGTH', '像素长度与尺寸不一致。');
    if (pixels.byteLength > MAX_ASSET_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', '图像超出本版本字节上限。');
    this.expire();
    if (id) this.drop(id);
    if (this.memory + pixels.byteLength > this.memoryLimit) {
      throw new AppError(413, 'MEMORY_LIMIT', '本地图像缓存已达上限，请释放后再试。');
    }
    const copy = Uint8Array.from(pixels);
    const info: AssetInfo = {
      id: id ?? ('asset_' + randomBytes(12).toString('hex')),
      width, height, kind,
      byteLength: copy.byteLength,
      sha256: canonicalSha256(copy)
    };
    this.assets.set(info.id, { info, pixels: copy, createdAt: this.now(), retain: 0 });
    this.memory += copy.byteLength;
    return info;
  }

  async putEncoded(buffer: Buffer, kind: AssetInfo['kind']): Promise<AssetInfo> {
    if (buffer.byteLength > MAX_ENCODED_BYTES) {
      throw new AppError(413, 'DOWNLOAD_TOO_LARGE', '编码图像超出下载上限。');
    }
    const decoded = await decodeEncoded(buffer);
    return this.putRgba(decoded.width, decoded.height, decoded.pixels, kind);
  }

  get(id: string): StoredAsset {
    this.expire();
    const asset = this.assets.get(id);
    if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', '找不到该图像资产。');
    return asset;
  }

  retain(id: string): void { this.get(id).retain++; }

  release(id: string): void {
    const asset = this.assets.get(id);
    if (!asset) return;
    if (asset.retain > 0) asset.retain--;
    if (asset.retain === 0) this.drop(id);
  }

  drop(id: string): void {
    const asset = this.assets.get(id);
    if (!asset) return;
    this.assets.delete(id);
    this.memory -= asset.pixels.byteLength;
    asset.pixels.fill(0);
  }

  expire(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, asset] of this.assets) {
      if (asset.retain === 0 && asset.createdAt < cutoff) this.drop(id);
    }
  }

  png(id: string): Buffer {
    const asset = this.get(id);
    return encodePngRgba(asset.info.width, asset.info.height, asset.pixels);
  }

  previewPng(id: string): Buffer {
    const asset = this.get(id);
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(asset.info.width, asset.info.height));
    const width = Math.max(1, Math.round(asset.info.width * scale));
    const height = Math.max(1, Math.round(asset.info.height * scale));
    const resized = resizeStraight(asset.pixels, asset.info.width, asset.info.height, width, height);
    return encodePngRgba(width, height, bakeCheckerboard(resized, width, height));
  }

  raw(id: string): { info: AssetInfo; pixels: Uint8Array } {
    const asset = this.get(id);
    return { info: asset.info, pixels: asset.pixels };
  }

  padToRequest(sourceId: string, requestWidth: number, requestHeight: number): {
    pixels: Uint8Array; geometry: ReturnType<typeof containFit>;
  } {
    const source = this.get(sourceId);
    const geometry = containFit(source.info.width, source.info.height, requestWidth, requestHeight);
    const sized = resizeStraight(source.pixels, source.info.width, source.info.height,
      geometry.contentWidth, geometry.contentHeight);
    const padded = new Uint8Array(requestWidth * requestHeight * 4);
    for (let y = 0; y < geometry.contentHeight; y++) {
      padded.set(
        sized.subarray(y * geometry.contentWidth * 4, (y + 1) * geometry.contentWidth * 4),
        ((geometry.padY + y) * requestWidth + geometry.padX) * 4
      );
    }
    return { pixels: padded, geometry };
  }

  normalizeModelResult(options: {
    sourceId: string;
    returned: { width: number; height: number; pixels: Uint8Array };
    requestWidth: number;
    requestHeight: number;
    alphaPolicy: AlphaPolicy;
  }): { asset: AssetInfo; geometry: GeometryMapping; exportId: string; previewId: string } {
    const source = this.get(options.sourceId);
    const geometry = mappingForReturn(
      source.info.width, source.info.height,
      options.requestWidth, options.requestHeight,
      options.returned.width, options.returned.height
    );
    const cropped = crop(options.returned.pixels, options.returned.width, options.returned.height, geometry.contentRect);
    const sized = resizeStraight(cropped, geometry.contentRect.width, geometry.contentRect.height,
      source.info.width, source.info.height);
    const applied = applyAlphaPolicy(source.pixels, sized, options.alphaPolicy);
    const asset = this.putRgba(source.info.width, source.info.height, applied, 'result');
    const encoded = this.png(asset.id);
    const verified = decodePngRgbaIndependent(encoded);
    if (verified.width !== asset.width || verified.height !== asset.height) {
      throw new AppError(500, 'OUTPUT_INVALID', 'PNG 独立解码尺寸不匹配。');
    }
    if (pixelSha256(canonicalRgba(verified.pixels)) !== asset.sha256) {
      throw new AppError(500, 'OUTPUT_INVALID', 'PNG 独立解码像素不匹配。');
    }
    const exportInfo = this.putRgba(asset.width, asset.height, applied, 'export');
    const preview = this.putRgba(asset.width, asset.height, applied, 'preview');
    return { asset, geometry, exportId: exportInfo.id, previewId: preview.id };
  }
}

export async function decodeEncoded(buffer: Buffer): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const isPng = buffer.length >= 4 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71;
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) {
    throw new AppError(400, 'INVALID_IMAGE', '仅接受 PNG、JPEG 或 WebP。');
  }
  if (isPng) {
    try { decodePngRgbaIndependent(buffer); }
    catch (error) {
      if (error instanceof AppError && error.code === 'ANIMATED_IMAGE') throw error;
    }
  }
  try {
    const pipeline = sharp(buffer, { failOn: 'error', sequentialRead: true, animated: true, pages: -1 });
    const meta = await pipeline.metadata();
    if ((meta.pages ?? 1) > 1) throw new AppError(400, 'ANIMATED_IMAGE', '不接受动画或多页图像。');
    if (meta.format !== 'png' && meta.format !== 'jpeg' && meta.format !== 'webp') {
      throw new AppError(400, 'INVALID_IMAGE', '仅接受 PNG、JPEG 或 WebP。');
    }
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    rgbaLength(width, height);
    const raw = await sharp(buffer, { failOn: 'error', sequentialRead: true })
      .toColorspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (raw.info.channels !== CHANNELS || raw.info.width !== width || raw.info.height !== height) {
      throw new AppError(400, 'INVALID_IMAGE', '解码后的通道或尺寸无效。');
    }
    if (raw.data.byteLength > MAX_ASSET_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', '图像超出本版本字节上限。');
    return { width: raw.info.width, height: raw.info.height, pixels: new Uint8Array(raw.data) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_IMAGE', '无法解码图像。');
  }
}

export function resizeStraight(
  pixels: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return pixels.slice();
  rgbaLength(dstW, dstH);
  return unpremultiplyToStraight(bilinearPremultiplied(premultiplyStraight(pixels), srcW, srcH, dstW, dstH));
}

export async function resizeStraightSharp(
  pixels: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number
): Promise<Uint8Array> {
  if (srcW === dstW && srcH === dstH) return pixels.slice();
  rgbaLength(dstW, dstH);
  const premul = Buffer.from(premultiplyStraight(pixels));
  const resized = await sharp(premul, { raw: { width: srcW, height: srcH, channels: 4 } })
    .resize(dstW, dstH, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  return unpremultiplyToStraight(new Uint8Array(resized));
}

function bilinearPremultiplied(
  pixels: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = fx - x0;
      const di = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = pixels[(y0 * srcW + x0) * 4 + c]!;
        const p10 = pixels[(y0 * srcW + x1) * 4 + c]!;
        const p01 = pixels[(y1 * srcW + x0) * 4 + c]!;
        const p11 = pixels[(y1 * srcW + x1) * 4 + c]!;
        const top = p00 + (p10 - p00) * wx;
        const bottom = p01 + (p11 - p01) * wx;
        out[di + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return out;
}

function crop(pixels: Uint8Array, width: number, height: number, rect: Rect): Uint8Array {
  if (rect.left < 0 || rect.top < 0 || rect.left + rect.width > width || rect.top + rect.height > height) {
    throw new AppError(422, 'OUTPUT_GEOMETRY_MISMATCH', '返回图像内容矩形越界。');
  }
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const src = ((rect.top + y) * width + rect.left) * 4;
    out.set(pixels.subarray(src, src + rect.width * 4), y * rect.width * 4);
  }
  return out;
}

function bakeCheckerboard(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = pixels.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = out[i + 3]! / 255;
      if (a >= 1) continue;
      const light = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0;
      const bg = light ? 220 : 160;
      out[i] = Math.round(out[i]! * a + bg * (1 - a));
      out[i + 1] = Math.round(out[i + 1]! * a + bg * (1 - a));
      out[i + 2] = Math.round(out[i + 2]! * a + bg * (1 - a));
      out[i + 3] = 255;
    }
  }
  return out;
}
