import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BRIDGE_PORT, JSON_BODY_LIMIT, MAX_PROMPT_CHARS, PROTOCOL_VERSION,
  type AlphaPolicy, type JobRequest, type ProviderKind, type ServiceConfig
} from '../../../packages/contracts/src/application.js';
import { AppError } from '../../../packages/contracts/src/errors.js';
import { rgbaLength } from '../../../packages/contracts/src/pixels.js';
import { baselineCatalog, loadBaselineInput } from '../../../packages/catalog/src/baseline.js';
import { fetchKeyVisibleIds, fetchPublicCatalog, withMock, buildFromParts } from '../../../packages/catalog/src/refresh.js';
import { AssetStore } from '../../../packages/image/src/store.js';
import { BudgetLedger } from './budget.js';
import { JobManager } from './jobs.js';
import { MockProvider } from './providers/mock.js';
import { CangyuanProvider } from './providers/cangyuan.js';
import type { ImageProvider } from './providers/types.js';


type Mode = 'identity' | 'invert' | 'failure' | 'slow' | 'late';
const MODES = new Set<Mode>(['identity', 'invert', 'failure', 'slow', 'late']);

export interface LocalServiceOptions {
  port?: number;
  slowMs?: number;
  lateMs?: number;
  env?: NodeJS.ProcessEnv;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function dimension(req: IncomingMessage, name: string): number {
  const value = req.headers[name];
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new AppError(400, 'INVALID_DIMENSIONS', '需要有效的图像宽高。');
  }
  return Number(value);
}

async function readExact(req: IncomingMessage, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    received += buffer.length;
    if (received > length) throw new AppError(413, 'INVALID_LENGTH', '内容超出声明长度。');
    chunks.push(buffer);
  }
  if (received !== length) throw new AppError(400, 'INVALID_LENGTH', '内容长度与声明不一致。');
  return Buffer.concat(chunks, length);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (!Number.isFinite(declared) || declared < 2 || declared > JSON_BODY_LIMIT) {
    throw new AppError(400, 'INVALID_LENGTH', 'JSON 长度无效。');
  }
  const raw = await readExact(req, declared);
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_REQUEST', 'JSON 无法解析。'); }
}

function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  if (origin.startsWith('uxp://') || origin.startsWith('plugin://')) return true;
  return false;
}

export async function startLocalService(options: LocalServiceOptions = {}) {
  const token = randomBytes(32).toString('hex');
  const expectedAuth = Buffer.from('Bearer ' + token);
  const env = options.env ?? process.env;
  let port = 0;
  let activeProbe = 0;
  const stats = { completed: 0, cancelled: 0, failures: 0 };
  const store = new AssetStore();
  const budget = new BudgetLedger();
  const baselineFile = loadBaselineInput();
  let catalog = withMock(baselineCatalog(false), 'mock');
  let providerKind: ProviderKind = 'mock';
  let apiKey: string | null = env.CANGYUAN_API_KEY && env.CANGYUAN_API_KEY.length > 0 ? env.CANGYUAN_API_KEY : null;
  let formatChecked = false;
  let authChecked = false;
  let liveImageVerified = false;
  let revision = 1;
  const sourceUploadVerified = false as const;
  const cangyuanBase = (env.CANGYUAN_BASE_URL ?? 'https://direct-api.cangyuansuanli.cn').replace(/\/+$/, '');

  const provider = (): ImageProvider => providerKind === 'cangyuan'
    ? new CangyuanProvider(store, { baseUrl: cangyuanBase, apiKey, sourceUploadVerified })
    : new MockProvider(store, options.slowMs ?? 40, options.lateMs ?? 80);

  const jobs = new JobManager(provider, () => catalog, budget, () => sourceUploadVerified);

  function config(): ServiceConfig {
    const snap = budget.snapshot();
    return {
      provider: providerKind,
      hasApiKey: Boolean(apiKey),
      liveEnabled: providerKind === 'cangyuan' && Boolean(apiKey),
      formatChecked, authChecked, liveImageVerified,
      spentFen: snap.spentFen, reservedFen: snap.reservedFen, spentAndReservedFen: snap.spentAndReservedFen,
      budgetLimitFen: snap.budgetLimitFen as 3000,
      sourceUploadVerified, revision,
      catalogCollectedAt: catalog.collectedAt,
      catalogSource: catalog.source
    };
  }

  function authorize(req: IncomingMessage): void {
    const authorization = Buffer.from(req.headers.authorization ?? '');
    if (authorization.length !== expectedAuth.length || !timingSafeEqual(authorization, expectedAuth)) {
      throw new AppError(401, 'UNAUTHORIZED', '本地服务配对无效。');
    }
  }

  const server = http.createServer(async (req, res) => {
    let ownsSlot = false;
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (req.headers.host !== '127.0.0.1:' + port) {
        throw new AppError(403, 'HOST_REJECTED', '只接受本机回环地址。');
      }
      if (!originAllowed(typeof req.headers.origin === 'string' ? req.headers.origin : undefined)) {
        throw new AppError(403, 'ORIGIN_REJECTED', '拒绝网页来源请求。');
      }
      authorize(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;

      if (req.method === 'GET' && path === '/v1/health') {
        reply(res, 200, {
          protocolVersion: PROTOCOL_VERSION,
          adapter: providerKind,
          activeRequests: activeProbe + jobs.listActive(),
          remoteGenerationEnabled: providerKind === 'cangyuan' && Boolean(apiKey),
          sourceUploadVerified,
          catalogSource: catalog.source,
          catalogCollectedAt: catalog.collectedAt
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/provider-config') {
        reply(res, 200, config());
        return;
      }

      if (req.method === 'PUT' && path === '/v1/provider-config') {
        if (jobs.listActive()) throw new AppError(409, 'BUSY', '生成中不能更改配置。');
        const body = await readJson(req) as { provider?: ProviderKind; apiKey?: string };
        if (body.provider === 'mock' || body.provider === 'cangyuan') providerKind = body.provider;
        if (typeof body.apiKey === 'string' && body.apiKey.length > 0) apiKey = body.apiKey;
        formatChecked = false; authChecked = false; liveImageVerified = false; revision++;
        catalog = withMock(baselineCatalog(false), providerKind);
        reply(res, 200, config());
        return;
      }

      if (req.method === 'POST' && path === '/v1/provider-config/check') {
        formatChecked = true;
        let level: 'format' | 'auth' = 'format';
        if (providerKind === 'cangyuan' && apiKey) {
          try {
            const ids = await fetchKeyVisibleIds(apiKey, cangyuanBase);
            catalog = withMock(buildFromParts({
              collectedAt: catalog.collectedAt,
              collectedAtLocal: catalog.collectedAtLocal,
              source: catalog.source,
              pricing: baselineFile.pricing,
              docs: baselineFile.docs,
              keyVisibleIds: ids,
              sourceUploadVerified: false
            }), providerKind);
            authChecked = true;
            level = 'auth';
          } catch {
            authChecked = false;
          }
        } else if (providerKind === 'mock') {
          authChecked = true;
          level = 'auth';
        }
        reply(res, 200, { level, message: level === 'auth' ? '鉴权通过，尚未验证图像编辑。' : '格式检查通过，尚未鉴权。', config: config() });
        return;
      }

      if (req.method === 'POST' && path === '/v1/provider-config/test-edit') {
        if (providerKind !== 'mock') {
          throw new AppError(409, 'IMAGE_EDIT_UNVERIFIED', '真实付费测试图需要已核对费用；当前未开放。');
        }
        liveImageVerified = true;
        reply(res, 200, { level: 'live-image', message: 'Mock 图像路径已验证，这不是真实模型验收。', config: config() });
        return;
      }

      if (req.method === 'GET' && path === '/v1/models') {
        reply(res, 200, {
          collectedAt: catalog.collectedAt,
          collectedAtLocal: catalog.collectedAtLocal,
          source: catalog.source,
          releaseBlocked: catalog.releaseBlocked,
          unadaptedIds: catalog.unadaptedIds,
          notes: catalog.notes,
          models: catalog.models
        });
        return;
      }

      if (req.method === 'POST' && path === '/v1/models/refresh') {
        try {
          const live = await fetchPublicCatalog();
          let keyVisibleIds: string[] | null = null;
          if (apiKey) {
            try { keyVisibleIds = await fetchKeyVisibleIds(apiKey, cangyuanBase); } catch { keyVisibleIds = null; }
          }
          catalog = withMock(buildFromParts({
            collectedAt: new Date().toISOString(),
            collectedAtLocal: new Date().toLocaleString('zh-CN'),
            source: 'live-refresh',
            pricing: live.pricing,
            docs: live.docs,
            keyVisibleIds,
            sourceUploadVerified: false
          }), providerKind);
        } catch {
          catalog = withMock(baselineCatalog(false), providerKind);
        }
        reply(res, 200, { collectedAt: catalog.collectedAt, source: catalog.source, count: catalog.models.length, releaseBlocked: catalog.releaseBlocked, unadaptedIds: catalog.unadaptedIds });
        return;
      }

      if (req.method === 'POST' && path === '/v1/assets') {
        const body = await readJson(req) as { width?: number; height?: number; byteLength?: number; kind?: 'source' };
        const width = Number(body.width), height = Number(body.height);
        const expected = rgbaLength(width, height);
        if (body.byteLength !== expected) throw new AppError(400, 'INVALID_LENGTH', '声明字节数与尺寸不一致。');
        const placeholder = store.putRgba(width, height, new Uint8Array(expected), 'source');
        reply(res, 201, placeholder);
        return;
      }

      const assetMatch = /^\/v1\/assets\/([^/]+)(?:\/(raw|png|preview|meta))?$/.exec(path);
      if (assetMatch) {
        const id = decodeURIComponent(assetMatch[1]!);
        const rest = assetMatch[2];
        if (req.method === 'PUT' && rest === 'raw') {
          const asset = store.get(id);
          const length = Number(req.headers['content-length'] ?? '-1');
          if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/octet-stream') {
            throw new AppError(415, 'CONTENT_TYPE', '需要未压缩的 RGBA 二进制。');
          }
          if (length !== asset.info.byteLength) throw new AppError(400, 'INVALID_LENGTH', '像素长度与尺寸不一致。');
          const raw = await readExact(req, length);
          const saved = store.putRgba(asset.info.width, asset.info.height, raw, 'source', id);
          reply(res, 200, saved);
          return;
        }
        if (req.method === 'GET' && (rest === 'meta' || rest === undefined)) {
          reply(res, 200, store.get(id).info);
          return;
        }
        if (req.method === 'GET' && rest === 'raw') {
          const { info, pixels } = store.raw(id);
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': pixels.byteLength,
            'x-image-width': info.width,
            'x-image-height': info.height,
            'x-pixel-sha256': info.sha256,
            'cache-control': 'no-store'
          });
          res.end(Buffer.from(pixels));
          return;
        }
        if (req.method === 'GET' && rest === 'png') {
          const png = store.png(id);
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.byteLength, 'cache-control': 'no-store' });
          res.end(png);
          return;
        }
        if (req.method === 'GET' && rest === 'preview') {
          const png = store.previewPng(id);
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.byteLength, 'cache-control': 'no-store' });
          res.end(png);
          return;
        }
        if (req.method === 'DELETE' && rest === undefined) {
          store.release(id);
          reply(res, 200, { released: true });
          return;
        }
      }

      if (req.method === 'POST' && path === '/v1/jobs') {
        const body = await readJson(req) as Partial<JobRequest>;
        if (typeof body.clientRequestId !== 'string' || !body.clientRequestId) {
          throw new AppError(400, 'INVALID_REQUEST', '缺少 clientRequestId。');
        }
        if (body.mode !== 'layer' && body.mode !== 'text') throw new AppError(400, 'UNSUPPORTED_MODE', '仅支持整层编辑或文字生图。');
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new AppError(400, 'PROMPT_REQUIRED', '请填写提示词。');
        if (body.prompt.length > MAX_PROMPT_CHARS) throw new AppError(400, 'INVALID_REQUEST', '提示词过长。');
        if (typeof body.model !== 'string') throw new AppError(400, 'INVALID_REQUEST', '缺少模型。');
        const jobRequest: JobRequest = {
          clientRequestId: body.clientRequestId,
          mode: body.mode,
          model: body.model,
          prompt: body.prompt.trim(),
          alphaPolicy: (body.alphaPolicy === 'use-model' ? 'use-model' : 'preserve-source') as AlphaPolicy,
          n: typeof body.n === 'number' ? body.n : 1,
          options: body.options ?? {}
        };
        if (typeof body.sourceAssetId === 'string') jobRequest.sourceAssetId = body.sourceAssetId;
        const created = jobs.create(jobRequest, providerKind === 'cangyuan');
        reply(res, 202, created);
        return;
      }

      const jobMatch = /^\/v1\/jobs\/([^/]+)(?:\/cancel)?$/.exec(path);
      if (jobMatch) {
        const id = decodeURIComponent(jobMatch[1]!);
        if (req.method === 'GET' && !path.endsWith('/cancel')) {
          reply(res, 200, jobs.get(id));
          return;
        }
        if (req.method === 'POST' && path.endsWith('/cancel')) {
          reply(res, 200, jobs.cancel(id));
          return;
        }
      }

      if (req.method === 'POST' && path === '/v1/mock/roundtrip') {
        if (activeProbe !== 0) throw new AppError(409, 'BUSY', '已有一个本地测试请求。');
        const contentType = req.headers['content-type']?.split(';')[0]?.trim();
        if (contentType !== 'application/octet-stream' || req.headers['content-encoding']) {
          throw new AppError(415, 'CONTENT_TYPE', '需要未压缩的 RGBA 二进制。');
        }
        const width = dimension(req, 'x-image-width');
        const height = dimension(req, 'x-image-height');
        let expectedLength: number;
        try { expectedLength = rgbaLength(width, height); }
        catch { throw new AppError(413, 'IMAGE_TOO_LARGE', '图像尺寸超出本版本限制。'); }
        if (req.headers['transfer-encoding'] || req.headers['content-length'] !== String(expectedLength)) {
          throw new AppError(400, 'INVALID_LENGTH', '需要精确的 RGBA Content-Length。');
        }
        const mode = (url.searchParams.get('mode') ?? 'identity') as Mode;
        if (!MODES.has(mode) || [...url.searchParams.keys()].some(k => k !== 'mode')) {
          throw new AppError(400, 'INVALID_REQUEST', '未知的 Mock 模式。');
        }
        activeProbe++;
        ownsSlot = true;
        const source = await readExact(req, expectedLength);
        if (mode === 'failure') throw new AppError(502, 'MOCK_FAILURE', '预设测试失败，未调用远端服务。');
        if (mode === 'slow') await delay(options.slowMs ?? 2000, undefined, { signal: controller.signal });
        if (mode === 'late') await delay(options.lateMs ?? 2000);
        if (controller.signal.aborted || res.destroyed) { stats.cancelled++; return; }
        const output = Buffer.from(source);
        if (mode === 'invert') {
          for (let i = 0; i < output.length; i += 4) {
            output[i] = 255 - output[i]!;
            output[i + 1] = 255 - output[i + 1]!;
            output[i + 2] = 255 - output[i + 2]!;
          }
        }
        const sha256 = createHash('sha256').update(output).digest('hex');
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': output.byteLength,
          'cache-control': 'no-store',
          'x-image-width': width,
          'x-image-height': height,
          'x-pixel-sha256': sha256
        });
        res.end(output);
        stats.completed++;
        return;
      }

      throw new AppError(404, 'NOT_FOUND', '没有此接口。');
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) { stats.cancelled++; return; }
      stats.failures++;
      const safe = error instanceof AppError ? error : new AppError(500, 'INTERNAL', '本地服务处理失败。');
      reply(res, safe.status, safe.toJSON());
    } finally {
      if (ownsSlot) activeProbe--;
    }
  });

  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 48;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? BRIDGE_PORT, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address.');
  port = address.port;
  return {
    port, token, url: 'http://127.0.0.1:' + port, stats, store, budget,
    catalog: () => catalog, config,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  };
}

export const startMockBridge = startLocalService;
