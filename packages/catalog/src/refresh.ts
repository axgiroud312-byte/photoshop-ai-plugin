import { adaptCatalog, mockModels, type CatalogInput, type ModelDoc, type PricingRow } from './adapt.js';
import type { CatalogSnapshot, ModelInfo } from '../../contracts/src/application.js';

export const CANGYUAN_PUBLIC_BASE = 'https://direct-api.cangyuansuanli.cn';
export const BASELINE_COLLECTED_AT = '2026-09-17T00:00:00.000Z';
export const BASELINE_COLLECTED_LOCAL = '2026-09-17 08:00:00 GMT+8';

export async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error('catalog fetch failed ' + response.status);
  return response.json();
}

export function pricingRows(payload: unknown): PricingRow[] {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: unknown }).data : payload;
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is PricingRow =>
    Boolean(row && typeof row === 'object' && 'model_name' in row));
}

export async function fetchPublicCatalog(fetcher: typeof fetchJson = fetchJson): Promise<{
  pricing: PricingRow[]; docs: Record<string, ModelDoc>;
}> {
  const pricing = pricingRows(await fetcher(CANGYUAN_PUBLIC_BASE + '/api/pricing'));
  const imageIds = pricing.filter(row => row.image_ui_params).map(row => row.model_name);
  const extra = ['nano-banana-pro', 'flux-pro-2'];
  const docs: Record<string, ModelDoc> = {};
  for (const id of [...new Set([...imageIds, ...extra])]) {
    try {
      docs[id] = await fetcher(CANGYUAN_PUBLIC_BASE + '/docs-static/models/' + id + '.json') as ModelDoc;
    } catch {
      // Missing docs stay absent; adaptCatalog will mark unadapted.
    }
  }
  return { pricing, docs };
}

export async function fetchKeyVisibleIds(apiKey: string, baseUrl = CANGYUAN_PUBLIC_BASE): Promise<string[]> {
  const payload = await fetchJson(baseUrl.replace(/\/v1\/?$/, '') + '/v1/models', {
    authorization: 'Bearer ' + apiKey
  });
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: unknown }).data : payload;
  if (!Array.isArray(data)) return [];
  return data.map(item => {
    if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') return item.id;
    return '';
  }).filter(Boolean);
}

export function withMock(snapshot: CatalogSnapshot, provider: 'mock' | 'cangyuan'): CatalogSnapshot {
  if (provider !== 'mock') return snapshot;
  return { ...snapshot, models: [...mockModels(snapshot.collectedAt), ...snapshot.models] };
}

export function findModel(snapshot: CatalogSnapshot, id: string): ModelInfo | undefined {
  return snapshot.models.find(model => model.id === id);
}

export function diffCatalog(previous: CatalogSnapshot, next: CatalogSnapshot): {
  added: string[]; removed: string[]; renamedHints: string[]; fieldChanges: string[];
} {
  const prevIds = new Set(previous.models.map(m => m.id));
  const nextIds = new Set(next.models.map(m => m.id));
  const added = [...nextIds].filter(id => !prevIds.has(id));
  const removed = [...prevIds].filter(id => !nextIds.has(id));
  const fieldChanges: string[] = [];
  for (const model of next.models) {
    const before = previous.models.find(m => m.id === model.id);
    if (!before) continue;
    if (before.fields.join(',') !== model.fields.join(',')) fieldChanges.push(model.id + ':fields');
    if (before.editRoute !== model.editRoute || before.generateRoute !== model.generateRoute) {
      fieldChanges.push(model.id + ':route');
    }
    if (before.sizes.join(',') !== model.sizes.join(',')) fieldChanges.push(model.id + ':sizes');
  }
  return { added, removed, renamedHints: [], fieldChanges };
}

export function buildFromParts(input: CatalogInput): CatalogSnapshot {
  return adaptCatalog(input);
}
