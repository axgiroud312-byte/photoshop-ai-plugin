import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version as string;
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const builtAt = new Date().toISOString();
const staging = resolve(root, '.local/pack-staging');
const outDir = resolve(root, 'artifacts');
await rm(staging, { recursive: true, force: true });
await mkdir(resolve(staging, 'plugin'), { recursive: true });
await mkdir(outDir, { recursive: true });
for (const file of ['manifest.json', 'index.html', 'styles.css', 'main.js']) {
  await cp(resolve(root, 'apps/plugin', file), resolve(staging, 'plugin', file));
}
const manifest = {
  name: 'photoshop-ai-plugin-dev',
  version, git: sha, builtAt, protocolVersion: 'photoshop-ai/0.1',
  note: '开发安装包。不含 API Key、Token、用户图片或 node_modules。'
};
await writeFile(resolve(staging, 'version.json'), JSON.stringify(manifest, null, 2));
await writeFile(resolve(staging, '安装说明.txt'), await readFile(resolve(root, 'docs/user/安装与使用.md'), 'utf8'));
const zipName = `photoshop-ai-${version}-${sha}.zip`;
const zipPath = resolve(outDir, zipName);
execFileSync('tar', ['-a', '-cf', zipPath, '-C', staging, '.'], { stdio: 'inherit' });
const bytes = await readFile(zipPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(resolve(outDir, zipName + '.sha256'), sha256 + '  ' + zipName + '\n');
console.log(JSON.stringify({ zip: zipPath, sha256, version, git: sha, builtAt, bytes: bytes.byteLength }, null, 2));
