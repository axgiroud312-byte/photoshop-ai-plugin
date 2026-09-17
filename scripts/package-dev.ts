import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: Math.floor(date.getSeconds() / 2) | (date.getMinutes() << 5) | (date.getHours() << 11),
    date: date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9)
  };
}

function buildUtf8Zip(files: { name: string; data: Buffer }[]): Buffer {
  const now = dosDateTime(new Date());
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (file.name.includes('\\') || file.name.startsWith('/') || file.name.includes('..')) {
      throw new Error('invalid zip path ' + file.name);
    }
    const nameBuf = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data) >>> 0;
    const gpFlag = 0x0800;
    const method = 8;
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04'), u16(20), u16(gpFlag), u16(method),
      u16(now.time), u16(now.date), u32(crc), u32(compressed.length), u32(file.data.length),
      u16(nameBuf.length), u16(0), nameBuf, compressed
    ]);
    const central = Buffer.concat([
      Buffer.from('PK\x01\x02'), u16(20), u16(20), u16(gpFlag), u16(method),
      u16(now.time), u16(now.date), u32(crc), u32(compressed.length), u32(file.data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.concat([
    Buffer.from('PK\x05\x06'), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBuf.length), u32(offset), u16(0)
  ]);
  return Buffer.concat([...locals, centralBuf, end]);
}

const root = resolve('.');
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version as string;
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const builtAt = new Date().toISOString();
const staging = resolve(root, '.local/pack-staging');
const outDir = resolve(root, 'artifacts');
await rm(staging, { recursive: true, force: true });
await mkdir(resolve(staging, 'plugin'), { recursive: true });
await mkdir(outDir, { recursive: true });
const pluginFiles = ['manifest.json', 'index.html', 'styles.css', 'main.js'] as const;
for (const file of pluginFiles) {
  await cp(resolve(root, 'apps/plugin', file), resolve(staging, 'plugin', file));
}
const manifest = {
  name: 'photoshop-ai-plugin-dev',
  version, git: sha, builtAt, protocolVersion: 'photoshop-ai/0.1',
  note: '开发安装包。不含 API Key、Token、用户图片或 node_modules。'
};
const versionJson = JSON.stringify(manifest, null, 2);
const installText = await readFile(resolve(root, 'docs/user/安装与使用.md'), 'utf8');
await writeFile(resolve(staging, 'version.json'), versionJson);
await writeFile(resolve(staging, '安装说明.txt'), installText);
const zipEntries = [
  { name: 'version.json', data: Buffer.from(versionJson, 'utf8') },
  { name: '安装说明.txt', data: Buffer.from(installText, 'utf8') },
  ...await Promise.all(pluginFiles.map(async file => ({
    name: 'plugin/' + file,
    data: await readFile(resolve(staging, 'plugin', file))
  })))
];
const zipName = `photoshop-ai-${version}-${sha}.zip`;
const zipPath = resolve(outDir, zipName);
const bytes = buildUtf8Zip(zipEntries);
for (const required of ['version.json', 'plugin/manifest.json', '安装说明.txt']) {
  if (!bytes.includes(Buffer.from(required, 'utf8'))) {
    throw new Error('zip is missing UTF-8 path ' + required);
  }
}
await writeFile(zipPath, bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(resolve(outDir, zipName + '.sha256'), sha256 + '  ' + zipName + '\n');
console.log(JSON.stringify({ zip: zipPath, sha256, version, git: sha, builtAt, bytes: bytes.byteLength }, null, 2));
