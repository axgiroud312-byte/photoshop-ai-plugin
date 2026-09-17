import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../../../packages/contracts/src/application.js';
import { startLocalService } from './server.js';

async function loadLocalEnv(): Promise<void> {
  try {
    const text = await readFile(resolve('.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // 没有 .env 时保持纯 Mock；不得从其他项目搜索 Key。
  }
}

await loadLocalEnv();
const bridge = await startLocalService();
const directory = resolve('.local');
const descriptor = resolve(directory, 'bridge-session.local.json');
try {
  await mkdir(directory, { recursive: true });
  await writeFile(descriptor, JSON.stringify({
    url: bridge.url, token: bridge.token, processId: process.pid,
    protocolVersion: PROTOCOL_VERSION,
    remoteGenerationEnabled: bridge.config().liveEnabled,
    listen: '127.0.0.1:47833'
  }, null, 2), { mode: 0o600 });
} catch (error) {
  await bridge.close();
  throw error;
}
console.log('本地服务已启动：' + bridge.url);
console.log('本次配对信息只保存在 .local/bridge-session.local.json。');
if (!bridge.config().liveEnabled) {
  console.log('当前为 Mock：不会调用远端模型，测试费用为 0。');
} else {
  console.log('已检测到 API Key，但仍须先核对人民币计价；未知费用不会发真实请求。');
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await bridge.close();
  await unlink(descriptor).catch(() => undefined);
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
