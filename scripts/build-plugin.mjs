import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginOut = resolve(root, 'apps/plugin/main.js');
const demoDir = resolve(root, 'apps/demo');

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['apps/plugin/src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  outfile: pluginOut,
  external: ['photoshop', 'uxp'],
  sourcemap: false,
  legalComments: 'none',
  target: 'es2020'
});

const emptyPlugin = {
  name: 'empty-host-modules',
  setup(build) {
    build.onResolve({ filter: /^(photoshop|uxp)$/ }, args => ({ path: args.path, namespace: 'empty-host' }));
    build.onLoad({ filter: /.*/, namespace: 'empty-host' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  }
};

await mkdir(demoDir, { recursive: true });
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['apps/plugin/src/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: resolve(demoDir, 'main.js'),
  plugins: [emptyPlugin],
  sourcemap: false,
  legalComments: 'none',
  target: 'es2020'
});

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-demo="true">
<head>
  <meta charset="utf-8">
  <title>DEMO / 模拟宿主 — AI 图层编辑</title>
  <link rel="stylesheet" href="../plugin/styles.css">
</head>
<body>
  <div id="app" class="app"></div>
  <script src="./main.js"></script>
</body>
</html>
`;
await writeFile(resolve(demoDir, 'index.html'), html);
const pluginJs = await readFile(pluginOut, 'utf8');
if (pluginJs.includes(root.replaceAll('\\', '\\\\')) || pluginJs.includes('C:\\\\Users')) {
  throw new Error('插件构建产物含有源码绝对路径。');
}
if (pluginJs.includes('node:crypto') || pluginJs.includes('require("crypto")')) {
  throw new Error('插件构建产物依赖 node:crypto，无法在 UXP 中加载。');
}
console.log('已构建 UXP 插件 apps/plugin/main.js 与浏览器 DEMO apps/demo/');
