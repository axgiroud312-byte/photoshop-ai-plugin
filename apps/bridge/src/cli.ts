import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMockBridge } from './server.js';

const bridge = await startMockBridge();
const directory = resolve('.local');
const descriptor = resolve(directory, 'bridge-session.local.json');
try {
  await mkdir(directory, { recursive: true });
  await writeFile(descriptor, JSON.stringify({
    url: bridge.url, token: bridge.token, processId: process.pid,
    protocolVersion: 'm0-probe/1', remoteGenerationEnabled: false
  }, null, 2), { mode: 0o600 });
} catch (error) {
  await bridge.close();
  throw error;
}
console.log('本地 Mock 服务已启动：' + bridge.url);
console.log('本次配对信息只保存在 .local/bridge-session.local.json。');
console.log('此版本不能调用远端模型，测试费用为 0。');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await bridge.close();
  await unlink(descriptor).catch(() => undefined);
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
