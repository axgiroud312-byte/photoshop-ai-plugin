import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../../../packages/contracts/src/errors.js';
import type { Candidate } from '../../../../packages/contracts/src/application.js';
import { requestCanvasForSource } from '../../../../packages/image/src/geometry.js';
import type { AssetStore } from '../../../../packages/image/src/store.js';
import { downloadHttpsImage, redactUrl } from '../download.js';
import type { ImageProvider, ProviderResult, ProviderSubmit } from './types.js';

export interface CangyuanOptions {
  baseUrl: string;
  apiKey: string | null;
  sourceUploadVerified: boolean;
  fetchImpl?: typeof fetch;
}

interface UpstreamTask {
  id?: string;
  status?: string;
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string; code?: string };
}

export class CangyuanProvider implements ImageProvider {
  readonly kind = 'cangyuan' as const;
  constructor(private readonly store: AssetStore, private readonly options: CangyuanOptions) {}

  private base(): string {
    return this.options.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  async submit(request: ProviderSubmit): Promise<{ providerTaskId?: string; submitPath: string }> {
    if (!this.options.apiKey) throw new AppError(401, 'PROVIDER_AUTH', '尚未设置 Cangyuan API Key。');
    if (request.mode === 'layer' && !this.options.sourceUploadVerified) {
      throw new AppError(409, 'SOURCE_UPLOAD_UNVERIFIED',
        '尚未证实可将本地图层安全发送给 Cangyuan，已阻止真实整层编辑。');
    }
    const path = request.mode === 'layer' && request.model.editRoute === 'edits'
      ? '/v1/images/edits' : '/v1/images/generations';
    if (request.mode === 'layer' && request.model.editRoute === 'none') {
      throw new AppError(400, 'EDIT_NOT_AVAILABLE', '当前模型未声明可编辑。');
    }
    const body = this.body(request);
    const response = await this.post(path, body);
    const task = await response.json() as UpstreamTask;
    const id = task.id;
    if (!response.ok && !id) {
      throw this.mapError(response.status, task);
    }
    return id ? { providerTaskId: id, submitPath: path } : { submitPath: path };
  }

  async poll(request: ProviderSubmit, handle: { providerTaskId?: string; submitPath?: string }): Promise<ProviderResult> {
    if (!handle.providerTaskId || !handle.submitPath) {
      return { status: 'unknown', candidates: [], settledFen: 0, error: { code: 'REQUEST_STATUS_UNKNOWN', message: '上游是否受理未知。', retryable: false } };
    }
    const url = this.base() + handle.submitPath + '/' + handle.providerTaskId;
    let last: UpstreamTask | undefined;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (request.signal.aborted) throw new AppError(409, 'USER_CANCELLED', '已取消本地等待。');
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        headers: this.headers()
      });
      last = await response.json() as UpstreamTask;
      const status = last.status ?? (response.ok ? 'in_progress' : 'failed');
      if (status === 'completed') return this.complete(request, handle, last);
      if (status === 'failed') throw this.mapError(response.status, last);
      await delay(2000, undefined, { signal: request.signal }).catch(() => undefined);
    }
    return { status: 'unknown', providerTaskId: handle.providerTaskId, submitPath: handle.submitPath, candidates: [], settledFen: 0,
      error: { code: 'REQUEST_STATUS_UNKNOWN', message: '轮询超时，上游任务可能仍在处理。', retryable: false } };
  }

  private body(request: ProviderSubmit): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model.id,
      prompt: request.prompt,
      n: Math.min(request.n, request.model.nMax),
      response_format: 'url',
      async: true
    };
    for (const field of request.model.fields) {
      if (field === 'model' || field === 'prompt' || field === 'n' || field === 'response_format' || field === 'async' || field === 'images' || field === 'mask' || field === 'mockMode') continue;
      const value = request.options[field] ?? request.model.defaults[field];
      if (value !== undefined) payload[field] = value;
    }
    if (request.mode === 'layer' && request.model.family === 'Midjourney') {
      payload.reference = 'editor';
    }
    return payload;
  }

  private async complete(request: ProviderSubmit, handle: { providerTaskId?: string; submitPath?: string }, task: UpstreamTask): Promise<ProviderResult> {
    const items = task.data ?? [];
    if (items.length === 0) throw new AppError(502, 'OUTPUT_INVALID', '上游没有返回可用图像。');
    const candidates: Candidate[] = [];
    for (const [index, item] of items.entries()) {
      let encoded: Buffer;
      if (item.b64_json) encoded = Buffer.from(item.b64_json, 'base64');
      else if (item.url) encoded = await downloadHttpsImage(item.url, this.options.fetchImpl);
      else throw new AppError(502, 'OUTPUT_INVALID', '候选缺少 url 或 b64。');
      const asset = await this.store.putEncoded(encoded, 'result');
      if (request.mode === 'layer' && request.sourceAssetId) {
        const source = this.store.get(request.sourceAssetId);
        const requestSize = requestCanvasForSource(source.info.width, source.info.height, String(request.options.size ?? ''), 1024);
        const normalized = this.store.normalizeModelResult({
          sourceId: request.sourceAssetId,
          returned: { width: asset.width, height: asset.height, pixels: this.store.raw(asset.id).pixels },
          requestWidth: requestSize.width,
          requestHeight: requestSize.height,
          alphaPolicy: request.alphaPolicy
        });
        candidates.push({
          ...normalized.asset, label: '候选 ' + (index + 1), warnings: request.model.warnings.slice(),
          previewAssetId: normalized.previewId, exportAssetId: normalized.exportId
        });
      } else {
        const preview = this.store.putRgba(asset.width, asset.height, this.store.raw(asset.id).pixels, 'preview');
        const exported = this.store.putRgba(asset.width, asset.height, this.store.raw(asset.id).pixels, 'export');
        candidates.push({ ...asset, label: '候选 ' + (index + 1), warnings: [], previewAssetId: preview.id, exportAssetId: exported.id });
      }
    }
    const completed: ProviderResult = { status: 'completed', candidates, settledFen: 0 };
    if (handle.providerTaskId !== undefined) completed.providerTaskId = handle.providerTaskId;
    if (handle.submitPath !== undefined) completed.submitPath = handle.submitPath;
    return completed;
  }

  private headers(): Record<string, string> {
    return {
      authorization: 'Bearer ' + (this.options.apiKey ?? ''),
      'content-type': 'application/json',
      accept: 'application/json'
    };
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return (this.options.fetchImpl ?? fetch)(this.base() + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    });
  }

  private mapError(status: number, task: UpstreamTask): AppError {
    const message = task.error?.message ?? '上游请求失败。';
    if (status === 401) return new AppError(401, 'PROVIDER_AUTH', '鉴权失败。');
    if (status === 429) return new AppError(429, 'PROVIDER_RATE_LIMIT', '上游限流。');
    if (status === 402) return new AppError(402, 'PROVIDER_QUOTA', '上游额度不足。');
    return new AppError(502, 'OUTPUT_INVALID', message);
  }
}

export function summarizeRequest(body: unknown): string {
  const json = JSON.stringify(body);
  return json.replace(/https:[^"]+/g, 'https://…').slice(0, 500);
}

export { redactUrl };
