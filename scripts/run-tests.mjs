import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const dir = resolve('dist/tests');
const files = (await readdir(dir)).filter(name => name.endsWith('.test.js')).map(name => resolve(dir, name));
if (files.length === 0) {
  console.error('没有编译后的测试文件。');
  process.exit(1);
}
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', windowsHide: true });
process.exitCode = await new Promise(resolveExit => child.on('close', resolveExit));
