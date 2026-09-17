import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptCatalog, type ModelDoc, type PricingRow } from './adapt.js';
import { BASELINE_COLLECTED_AT, BASELINE_COLLECTED_LOCAL } from './refresh.js';
import type { CatalogSnapshot } from '../../contracts/src/application.js';

interface BaselineFile {
  collectedAt: string;
  collectedAtLocal: string;
  pricing: PricingRow[];
  docs: Record<string, ModelDoc>;
}

function baselinePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../data/baseline-input.json'),
    resolve(here, '../../../packages/catalog/data/baseline-input.json'),
    resolve('packages/catalog/data/baseline-input.json')
  ];
  for (const candidate of candidates) {
    try { readFileSync(candidate); return candidate; } catch { /* next */ }
  }
  throw new Error('找不到模型目录基线文件。');
}

export function loadBaselineInput(): BaselineFile {
  return JSON.parse(readFileSync(baselinePath(), 'utf8')) as BaselineFile;
}

export function baselineCatalog(sourceUploadVerified = false): CatalogSnapshot {
  const file = loadBaselineInput();
  return adaptCatalog({
    collectedAt: file.collectedAt || BASELINE_COLLECTED_AT,
    collectedAtLocal: file.collectedAtLocal || BASELINE_COLLECTED_LOCAL,
    source: 'baseline-cache',
    pricing: file.pricing,
    docs: file.docs,
    keyVisibleIds: null,
    sourceUploadVerified
  });
}
