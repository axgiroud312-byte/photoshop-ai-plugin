import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { rgbaLength } from '../../../packages/contracts/src/pixels.js';

type Mode = 'identity' | 'invert' | 'failure' | 'slow' | 'late';
const MODES = new Set<Mode>(['identity', 'invert', 'failure', 'slow', 'late']);

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function dimension(req: IncomingMessage, name: string): number {
  const value = req.headers[name];
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new HttpError(400, 'INVALID_DIMENSIONS', '需要有效的图像宽高。');
  }
  return Number(value);
}

async function readPixels(req: IncomingMessage, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > length) {
      throw new HttpError(413, 'INVALID_LENGTH', '像素长度超出声明。');
    }
    chunks.push(buffer);
  }
  if (received !== length) {
    throw new HttpError(400, 'INVALID_LENGTH', '像素长度与尺寸不一致。');
  }
  return Buffer.concat(chunks, length);
}

export interface MockBridgeOptions {
  port?: number;
  slowMs?: number;
  lateMs?: number;
}

// M0 transport probe only. This is not the future /assets + /jobs service.
export async function startMockBridge(options: MockBridgeOptions = {}) {
  const token = randomBytes(32).toString('hex');
  const expectedAuth = Buffer.from('Bearer ' + token);
  let active = 0;
  let port = 0;
  const stats = { completed: 0, cancelled: 0, failures: 0 };

  const server = http.createServer(async (req, res) => {
    let ownsSlot = false;
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (req.headers.host !== '127.0.0.1:' + port) {
        throw new HttpError(403, 'HOST_REJECTED', '只接受本机回环地址。');
      }
      if (req.headers.origin !== undefined) {
        throw new HttpError(403, 'ORIGIN_REJECTED', '此探针不接受网页来源请求。');
      }
      const authorization = Buffer.from(req.headers.authorization ?? '');
      if (authorization.length !== expectedAuth.length ||
          !timingSafeEqual(authorization, expectedAuth)) {
        throw new HttpError(401, 'UNAUTHORIZED', '本地服务配对无效。');
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        reply(res, 200, { protocolVersion: 'm0-probe/1', adapter: 'mock-only',
          activeRequests: active, remoteGenerationEnabled: false });
        return;
      }
      if (req.method !== 'POST' || url.pathname !== '/v1/mock/roundtrip') {
        throw new HttpError(404, 'NOT_FOUND', '没有此探针接口。');
      }
      if (active !== 0) {
        throw new HttpError(409, 'BUSY', '已有一个本地测试请求。');
      }
      const contentType = req.headers['content-type']?.split(';')[0]?.trim();
      if (contentType !== 'application/octet-stream' || req.headers['content-encoding']) {
        throw new HttpError(415, 'CONTENT_TYPE', '需要未压缩的 RGBA 二进制。');
      }
      const width = dimension(req, 'x-image-width');
      const height = dimension(req, 'x-image-height');
      let expectedLength: number;
      try { expectedLength = rgbaLength(width, height); }
      catch { throw new HttpError(413, 'IMAGE_TOO_LARGE', '图像尺寸超出本版本限制。'); }
      if (req.headers['transfer-encoding'] ||
          req.headers['content-length'] !== String(expectedLength)) {
        throw new HttpError(400, 'INVALID_LENGTH', '需要精确的 RGBA Content-Length。');
      }
      const mode = (url.searchParams.get('mode') ?? 'identity') as Mode;
      if (!MODES.has(mode) || [...url.searchParams.keys()].some(k => k !== 'mode')) {
        throw new HttpError(400, 'INVALID_MODE', '未知的 Mock 模式。');
      }
      active++;
      ownsSlot = true;
      const source = await readPixels(req, expectedLength);
      if (mode === 'failure') {
        throw new HttpError(502, 'MOCK_FAILURE', '预设测试失败，未调用远端服务。');
      }
      if (mode === 'slow') {
        await delay(options.slowMs ?? 2000, undefined, { signal: controller.signal });
      }
      if (mode === 'late') {
        // Simulate a provider which ignores cancellation; never emit a late success.
        await delay(options.lateMs ?? 2000);
      }
      if (controller.signal.aborted || res.destroyed) {
        stats.cancelled++;
        return;
      }
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
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) {
        stats.cancelled++;
        return;
      }
      stats.failures++;
      const safeError = error instanceof HttpError ? error :
        new HttpError(500, 'INTERNAL', '本地探针处理失败。');
      reply(res, safeError.status, { error: { code: safeError.code,
        message: safeError.message } });
    } finally {
      if (ownsSlot) active--;
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 47833, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address.');
  port = address.port;
  return {
    port, token, url: 'http://127.0.0.1:' + port, stats,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  };
}
