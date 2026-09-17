import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(p => p.endsWith('.md'));
const missing = [];
let checked = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    let target = match[1];
    if (/^(?:https?:|#|mailto:)/.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    checked++;
    if (!existsSync(resolve(dirname(file), target))) missing.push({ file, target });
  }
}
console.log(JSON.stringify({ documents: files.length, localLinks: checked, missing }, null, 2));
if (missing.length) process.exitCode = 1;
