import { setTimeout as delay } from 'node:timers/promises';
import type { Candidate } from '../../../../packages/contracts/src/application.js';
import { AppError } from '../../../../packages/contracts/src/errors.js';
import { makeFixture } from '../../../../packages/contracts/src/pixels.js';
import { requestCanvasForSource } from '../../../../packages/image/src/geometry.js';
import type { AssetStore } from '../../../../packages/image/src/store.js';
import type { ImageProvider, ProviderResult, ProviderSubmit } from './types.js';

export class MockProvider implements ImageProvider {
  readonly kind = 'mock' as const;
  constructor(
    private readonly store: AssetStore,
    private readonly slowMs = 40,
    private readonly lateMs = 80
  ) {}

  async submit(): Promise<{ providerTaskId: string; submitPath: string }> {
    return { providerTaskId: 'mock_' + Date.now(), submitPath: '/mock/jobs' };
  }

  async poll(request: ProviderSubmit, handle: { providerTaskId?: string; submitPath?: string }): Promise<ProviderResult> {
    const mode = String(request.options.mockMode ?? request.model.defaults.mockMode ?? 'identity');
    if (mode === 'slow') await delay(this.slowMs, undefined, { signal: request.signal });
    if (mode === 'late') await delay(this.lateMs);
    if (request.signal.aborted) throw new AppError(409, 'USER_CANCELLED', '已取消。');
    if (mode === 'failure') throw new AppError(502, 'MOCK_FAILURE', '预设测试失败，未调用远端服务。');
    const variants = mode === 'multi' ? 4 : 1;

    if (request.mode === 'text' || mode === 'text') {
      const size = String(request.options.size ?? '64x64');
      const [w, h] = size.includes('x') ? size.split('x').map(Number) : [64, 64];
      const images = [];
      for (let i = 0; i < variants; i++) {
        const fixture = makeFixture(w || 64, h || 64);
        paintPrompt(fixture.pixels, request.prompt);
        if (i > 0) invertRgb(fixture.pixels, i * 13);
        images.push({ width: fixture.width, height: fixture.height, pixels: fixture.pixels });
      }
      return this.complete(request, handle, images);
    }

    if (!request.sourceAssetId) throw new AppError(400, 'INVALID_REQUEST', '整层编辑需要源图资产。');
    const source = this.store.get(request.sourceAssetId);
    const requestSize = requestCanvasForSource(source.info.width, source.info.height, String(request.options.size ?? ''), 1024);
    const padded = this.store.padToRequest(request.sourceAssetId, requestSize.width, requestSize.height);

    if (mode === 'geometry') {
      const bad = { width: requestSize.width, height: Math.max(1, Math.round(requestSize.height * 1.5)), pixels: padded.pixels };
      try {
        this.store.normalizeModelResult({
          sourceId: request.sourceAssetId, returned: bad,
          requestWidth: requestSize.width, requestHeight: requestSize.height,
          alphaPolicy: request.alphaPolicy
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw error;
      }
    }

    const images = [];
    for (let i = 0; i < variants; i++) {
      const pixels = padded.pixels.slice();
      if (mode === 'invert' || mode === 'multi' || i > 0) invertRgb(pixels, i * 13);
      images.push({ width: requestSize.width, height: requestSize.height, pixels });
    }
    return this.complete(request, handle, images, requestSize.width, requestSize.height, request.sourceAssetId);
  }

  private complete(
    request: ProviderSubmit,
    handle: { providerTaskId?: string; submitPath?: string },
    images: Array<{ width: number; height: number; pixels: Uint8Array }>,
    requestWidth?: number,
    requestHeight?: number,
    sourceId?: string
  ): ProviderResult {
    const candidates: Candidate[] = images.map((image, index) => {
      if (sourceId && requestWidth && requestHeight) {
        const normalized = this.store.normalizeModelResult({
          sourceId, returned: image, requestWidth, requestHeight, alphaPolicy: request.alphaPolicy
        });
        return {
          ...normalized.asset,
          label: '候选 ' + (index + 1),
          warnings: [],
          previewAssetId: normalized.previewId,
          exportAssetId: normalized.exportId
        };
      }
      const asset = this.store.putRgba(image.width, image.height, image.pixels, 'result');
      const preview = this.store.putRgba(image.width, image.height, image.pixels, 'preview');
      const exported = this.store.putRgba(image.width, image.height, image.pixels, 'export');
      return { ...asset, label: '候选 ' + (index + 1), warnings: [], previewAssetId: preview.id, exportAssetId: exported.id };
    });
    const completed: ProviderResult = { status: 'completed', candidates, settledFen: 0 };
    if (handle.providerTaskId !== undefined) completed.providerTaskId = handle.providerTaskId;
    if (handle.submitPath !== undefined) completed.submitPath = handle.submitPath;
    return completed;
  }
}

function invertRgb(pixels: Uint8Array, shift = 0): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (255 - pixels[i]! + shift) & 255;
    pixels[i + 1] = (255 - pixels[i + 1]! + shift) & 255;
    pixels[i + 2] = (255 - pixels[i + 2]! + shift) & 255;
  }
}

function paintPrompt(pixels: Uint8Array, prompt: string): void {
  let hash = 0;
  for (const ch of prompt) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    pixels[i] = (pixels[i]! ^ (hash & 255)) & 255;
    pixels[i + 1] = (pixels[i + 1]! ^ ((hash >>> 8) & 255)) & 255;
  }
}
