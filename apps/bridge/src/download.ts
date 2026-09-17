import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { MAX_DOWNLOAD_REDIRECTS, MAX_ENCODED_BYTES } from '../../../packages/contracts/src/application.js';
import { AppError } from '../../../packages/contracts/src/errors.js';

const BLOCKED = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./, /^255\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i
];

export function isBlockedIp(address: string): boolean {
  return BLOCKED.some(pattern => pattern.test(address));
}

export async function assertSafeHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError(400, 'SSRF_REJECTED', '结果地址无效。'); }
  if (url.protocol !== 'https:') throw new AppError(400, 'SSRF_REJECTED', '只下载 HTTPS 结果。');
  if (url.username || url.password) throw new AppError(400, 'SSRF_REJECTED', '结果地址含有用户信息。');
  if (url.port && url.port !== '443') throw new AppError(400, 'SSRF_REJECTED', '结果地址端口不受支持。');
  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new AppError(400, 'SSRF_REJECTED', '拒绝回环主机名。');
  }
  if (isIP(hostname) && isBlockedIp(hostname)) throw new AppError(400, 'SSRF_REJECTED', '拒绝私网地址。');
  const looked = await lookup(hostname, { all: true });
  if (looked.length === 0 || looked.some(item => isBlockedIp(item.address))) {
    throw new AppError(400, 'SSRF_REJECTED', '拒绝解析到私网或回环的地址。');
  }
  return url;
}

export async function downloadHttpsImage(
  raw: string,
  fetchImpl: typeof fetch = fetch,
  redirects = 0
): Promise<Buffer> {
  if (redirects > MAX_DOWNLOAD_REDIRECTS) throw new AppError(400, 'SSRF_REJECTED', '重定向次数过多。');
  const url = await assertSafeHttpsUrl(raw);
  const response = await fetchImpl(url, { redirect: 'manual', headers: { accept: 'image/png,image/jpeg,image/webp' } });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new AppError(400, 'SSRF_REJECTED', '重定向缺少地址。');
    return downloadHttpsImage(new URL(location, url).toString(), fetchImpl, redirects + 1);
  }
  if (!response.ok) throw new AppError(502, 'OUTPUT_INVALID', '无法下载模型结果。');
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_ENCODED_BYTES) throw new AppError(413, 'DOWNLOAD_TOO_LARGE', '结果体积超出上限。');
  const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (mime && !['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(mime)) {
    throw new AppError(415, 'OUTPUT_INVALID', '结果类型不是图像。');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ENCODED_BYTES) throw new AppError(413, 'DOWNLOAD_TOO_LARGE', '结果体积超出上限。');
  return buffer;
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin + '/…';
  } catch {
    return '[redacted-url]';
  }
}
