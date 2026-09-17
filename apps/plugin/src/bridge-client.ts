import { PROTOCOL_VERSION, type JobInfo, type ModelInfo, type ServiceConfig } from '../../../packages/contracts/src/application.js';

export class BridgeClient {
  constructor(public url: string, public token: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: 'Bearer ' + this.token, ...extra };
  }

  async health(): Promise<{ protocolVersion: string; remoteGenerationEnabled: boolean }> {
    const body = await this.json('/v1/health');
    if (body.protocolVersion && body.protocolVersion !== PROTOCOL_VERSION) {
      const error = new Error('VERSION_INCOMPATIBLE');
      throw error;
    }
    return body;
  }

  async config(): Promise<ServiceConfig> { return this.json('/v1/provider-config'); }
  async models(): Promise<{ models: ModelInfo[]; collectedAt: string; source: string; releaseBlocked: boolean }> {
    return this.json('/v1/models');
  }
  async saveConfig(payload: { provider?: 'mock' | 'cangyuan'; apiKey?: string }): Promise<ServiceConfig> {
    return this.json('/v1/provider-config', { method: 'PUT', json: payload });
  }
  async check(): Promise<{ level: string; message: string; config: ServiceConfig }> {
    return this.json('/v1/provider-config/check', { method: 'POST', json: {} });
  }
  async testEdit(): Promise<{ level: string; message: string }> {
    return this.json('/v1/provider-config/test-edit', { method: 'POST', json: {} });
  }
  async refreshCatalog(): Promise<unknown> { return this.json('/v1/models/refresh', { method: 'POST', json: {} }); }

  async uploadRgba(width: number, height: number, pixels: Uint8Array): Promise<{ id: string; sha256: string }> {
    const meta = await this.json('/v1/assets', { method: 'POST', json: { width, height, byteLength: pixels.byteLength, kind: 'source' } });
    const response = await fetch(this.url + '/v1/assets/' + meta.id + '/raw', {
      method: 'PUT',
      headers: this.headers({ 'content-type': 'application/octet-stream', 'content-length': String(pixels.byteLength) }),
      body: pixels
    });
    if (!response.ok) throw new Error('asset upload failed');
    return response.json();
  }

  async createJob(payload: unknown): Promise<JobInfo> {
    return this.json('/v1/jobs', { method: 'POST', json: payload });
  }
  async job(id: string): Promise<JobInfo> { return this.json('/v1/jobs/' + id); }
  async cancel(id: string): Promise<JobInfo> { return this.json('/v1/jobs/' + id + '/cancel', { method: 'POST', json: {} }); }
  previewUrl(id: string): string { return this.url + '/v1/assets/' + id + '/preview'; }
  pngUrl(id: string): string { return this.url + '/v1/assets/' + id + '/png'; }
  async png(id: string): Promise<Uint8Array> {
    const response = await fetch(this.url + '/v1/assets/' + id + '/png', { headers: this.headers() });
    return new Uint8Array(await response.arrayBuffer());
  }
  async raw(id: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const response = await fetch(this.url + '/v1/assets/' + id + '/raw', { headers: this.headers() });
    return {
      width: Number(response.headers.get('x-image-width')),
      height: Number(response.headers.get('x-image-height')),
      pixels: new Uint8Array(await response.arrayBuffer())
    };
  }

  private async json(path: string, init: { method?: string; json?: unknown } = {}): Promise<any> {
    const headers = this.headers(init.json ? { 'content-type': 'application/json' } : {});
    const body = init.json ? JSON.stringify(init.json) : undefined;
    const response = await fetch(this.url + path, { method: init.method ?? 'GET', headers, body });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? '请求失败');
      (error as Error & { code?: string }).code = payload?.error?.code;
      throw error;
    }
    return payload;
  }
}
