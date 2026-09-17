import type { HostAdapter } from '../../../packages/host/src/types.js';
import { MockHost } from '../../../packages/host/src/mock.js';
import { PhotoshopHost } from './uxp-adapter.js';

export async function createHost(demo: boolean): Promise<HostAdapter> {
  if (demo) return new MockHost();
  const ps = require('photoshop') as typeof import('photoshop');
  if (!ps?.imaging || !ps?.core) {
    throw new Error('当前环境没有 Photoshop Imaging API，不能静默改用 Mock。');
  }
  return new PhotoshopHost(ps);
}
