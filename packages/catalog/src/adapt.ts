import { createHash } from 'node:crypto';
import type { CatalogKind, CatalogSnapshot, ModelInfo, NativeCandidateShape } from '../../contracts/src/application.js';

export interface PricingRow {
  model_name: string;
  model_price?: number;
  description?: string;
  supported_endpoint_types?: string[];
  image_ui_params?: {
    referenceLimits?: { images?: number; mask?: number };
    params?: {
      count?: { max?: number };
      aspectRatio?: { options?: Array<{ value?: string }> };
      quality?: { enabled?: boolean; options?: Array<{ value?: string }> };
      background?: { enabled?: boolean; options?: Array<{ value?: string }> };
      outputFormat?: { options?: Array<{ value?: string }> };
    };
  };
}

export interface ModelDoc {
  params?: Array<{ name?: string }>;
  endpoints?: Array<{ method?: string; path?: string }>;
  intro?: string;
}

export interface CatalogInput {
  collectedAt: string;
  collectedAtLocal: string;
  source: CatalogSnapshot['source'];
  pricing: PricingRow[];
  docs: Record<string, ModelDoc>;
  keyVisibleIds: string[] | null;
  sourceUploadVerified: boolean;
}

const GPT_QUALITY = ['low', 'medium', 'high', 'xhigh', 'max'];
const GEMINI_QUALITY = ['1k', '2k', '4k'];
const MJ_SPEEDS = ['relax', 'fast'];

function familyOf(id: string): string {
  if (id.startsWith('doubao-seedream')) return 'Seedream';
  if (id.startsWith('gemini-')) return 'Gemini';
  if (id.startsWith('gpt-image')) return 'GPT Image';
  if (id.startsWith('grok-imagine')) return 'Grok';
  if (id.startsWith('midjourney')) return 'Midjourney';
  if (id.startsWith('nano-banana')) return 'Nano Banana';
  if (id.startsWith('flux-')) return 'FLUX';
  return 'Unknown';
}

function optionValues(options: Array<{ value?: string }> | undefined): string[] {
  return (options ?? []).map(o => o.value).filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function intersect(a: string[], b: string[]): string[] {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  return a.filter(x => b.includes(x));
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function adaptCatalog(input: CatalogInput): CatalogSnapshot {
  const pricingImage = input.pricing.filter(row => row.image_ui_params);
  const pricingIds = new Set(pricingImage.map(row => row.model_name));
  const docIds = new Set(Object.keys(input.docs));
  const allIds = [...new Set([...pricingIds, ...docIds])].sort();
  const models: ModelInfo[] = [];
  const unadaptedIds: string[] = [];
  const notes: string[] = [];

  for (const id of allIds) {
    const pricing = pricingImage.find(row => row.model_name === id);
    const doc = input.docs[id];
    if (!doc) {
      unadaptedIds.push(id);
      notes.push(id + ' 出现在定价目录但缺少模型文档，已阻止发布。');
      models.push(unadaptedModel(id, pricing, input, id + ' 缺少模型文档，已阻止发布。'));
      continue;
    }
    const family = familyOf(id);
    if (family === 'Unknown') {
      unadaptedIds.push(id);
      notes.push(id + ' 为新发现图像模型，尚未适配。');
      models.push(unadaptedModel(id, pricing, input, id + ' 为新发现图像模型，尚未适配。'));
      continue;
    }
    models.push(adaptOne(id, family, pricing, doc, input));
  }

  return {
    collectedAt: input.collectedAt,
    collectedAtLocal: input.collectedAtLocal,
    source: input.source,
    pricingHash: stableHash(pricingImage.map(row => row.model_name).sort()),
    docsHash: stableHash([...docIds].sort()),
    keyListHash: input.keyVisibleIds ? stableHash([...input.keyVisibleIds].sort()) : null,
    models,
    unadaptedIds,
    releaseBlocked: unadaptedIds.length > 0,
    notes
  };
}

function unadaptedModel(
  id: string,
  pricing: PricingRow | undefined,
  input: CatalogInput,
  warning: string
): ModelInfo {
  return {
    id, family: 'Unknown', catalog: 'new-unadapted',
    fields: ['model', 'prompt', 'n', 'response_format', 'async'],
    sizes: [], qualities: [], speeds: [], outputFormats: [],
    nMin: 1, nMax: 1, nativeCandidates: 1, nativeCandidateShape: 'unknown',
    defaults: { n: 1, response_format: 'url', async: true },
    declaredText: false, declaredEdit: false, editRoute: 'none', generateRoute: 'none',
    maxReferenceImages: 0, maskDeclared: false, adapted: false, mockVerified: false,
    liveVerified: false, editReady: false, outputAlphaVerified: false,
    keyVisible: input.keyVisibleIds ? input.keyVisibleIds.includes(id) : null,
    publicListed: Boolean(pricing), docsListed: Boolean(input.docs[id]),
    costFenUnknown: true,
    publicPriceHint: typeof pricing?.model_price === 'number' ? pricing.model_price : null,
    warnings: [warning],
    documentation: 'https://direct-api.cangyuansuanli.cn/docs-static/models/' + id + '.json',
    collectedAt: input.collectedAt
  };
}

function adaptOne(
  id: string,
  family: string,
  pricing: PricingRow | undefined,
  doc: ModelDoc,
  input: CatalogInput
): ModelInfo {
  const warnings: string[] = [];
  const docFields = (doc.params ?? []).map(p => p.name).filter((n): n is string => typeof n === 'string');
  const endpoints = (doc.endpoints ?? []).map(e => `${e.method ?? ''} ${e.path ?? ''}`.trim());
  const hasEdits = endpoints.some(e => e.includes('/v1/images/edits') && e.startsWith('POST'));
  const hasGenerations = endpoints.some(e => e.includes('/v1/images/generations') && e.startsWith('POST'));
  const pricingImages = pricing?.image_ui_params?.referenceLimits?.images ?? 0;
  const pricingMask = (pricing?.image_ui_params?.referenceLimits?.mask ?? 0) > 0;
  const docHasImages = docFields.includes('images');
  const docHasMask = docFields.includes('mask');
  const nMaxPricing = pricing?.image_ui_params?.params?.count?.max ?? 1;
  const sizesPricing = optionValues(pricing?.image_ui_params?.params?.aspectRatio?.options).filter(v => v !== 'auto');
  const qualityPricing = optionValues(pricing?.image_ui_params?.params?.quality?.options);
  const outputPricing = optionValues(pricing?.image_ui_params?.params?.outputFormat?.options);
  const catalog: CatalogKind = pricing ? 'public' : 'documentation-only';

  let fields = ['model', 'prompt', 'n', 'size', 'response_format', 'async'];
  let qualities: string[] = [];
  let speeds: string[] = [];
  let outputFormats = outputPricing.slice();
  let nMax = Math.max(1, Math.min(nMaxPricing, 4));
  let nativeCandidates = 1;
  let nativeCandidateShape: NativeCandidateShape = 'unknown';
  let maxReferenceImages = 0;
  let declaredEdit = false;
  let editRoute: ModelInfo['editRoute'] = 'none';
  const generateRoute: ModelInfo['generateRoute'] = hasGenerations ? 'generations' : 'none';
  const defaults: Record<string, string | number | boolean> = { n: 1, response_format: 'url', async: true };

  if (family === 'Gemini') {
    fields = [...fields, 'quality', 'images'];
    qualities = GEMINI_QUALITY.slice();
    defaults.quality = '1k';
    maxReferenceImages = Math.min(pricingImages || 9, 9);
    declaredEdit = hasEdits && docHasImages;
    editRoute = declaredEdit ? 'edits' : 'none';
    if (sizesPricing.includes('auto') || (doc.intro ?? '').includes('不要传 auto')) {
      warnings.push('Gemini 的自动比例应省略 size，不发送 auto。');
    }
  } else if (family === 'GPT Image') {
    const fixedTier = /-(1k|2k|4k)$/.test(id);
    if (docFields.includes('quality')) fields.push('quality');
    fields.push('images');
    if (fixedTier) nMax = 1;
    else nMax = Math.min(nMaxPricing, 4);
    if (docFields.includes('quality')) {
      const conservative = qualityPricing.length ? intersect(qualityPricing, GPT_QUALITY) : GPT_QUALITY.slice();
      qualities = conservative.length ? conservative : ['medium'];
      if (qualityPricing.length && qualityPricing.length < GPT_QUALITY.length) {
        warnings.push('定价与文档的 quality 枚举不一致，仅开放交集。');
      }
      defaults.quality = qualities.includes('medium') ? 'medium' : qualities[0]!;
    }
    if (pricing?.image_ui_params?.params?.background?.enabled) {
      warnings.push('定价 UI 含 background/transparent，模型字段表未列 background，不发送该参数。');
    }
    maxReferenceImages = Math.min(pricingImages || 9, 9);
    declaredEdit = hasEdits && docHasImages;
    editRoute = declaredEdit ? 'edits' : 'none';
    if (id === 'gpt-image-2' && pricingMask && !docHasMask) {
      warnings.push('定价标 mask，模型页明确不支持蒙版；首版不发送 mask。');
    }
    if (docHasMask) warnings.push('模型声明 mask，但 v0.1 不开放蒙版工作流。');
  } else if (family === 'Grok') {
    if (id === 'grok-imagine-image-lite') {
      declaredEdit = false;
      maxReferenceImages = 0;
      nMax = 1;
    } else if (id === 'grok-imagine-image-2.0') {
      declaredEdit = false;
      maxReferenceImages = 0;
      warnings.push('定价称仅文生图，模型页列出 images；编辑标为待验证。');
      if (docHasImages) fields = [...fields];
    } else {
      fields = [...fields, 'images'];
      declaredEdit = hasEdits && docHasImages;
      editRoute = declaredEdit ? 'edits' : 'none';
      maxReferenceImages = 1;
    }
    nMax = 1;
  } else if (family === 'Midjourney') {
    fields = ['model', 'prompt', 'n', 'size', 'speed', 'images', 'reference', 'response_format', 'async'];
    speeds = MJ_SPEEDS.slice();
    defaults.speed = 'relax';
    defaults.n = 1;
    nMax = 1;
    nativeCandidates = 4;
    nativeCandidateShape = 'unknown';
    declaredEdit = true;
    editRoute = 'edits';
    maxReferenceImages = 1;
    warnings.push('n=1 仍可能返回四张候选；未证实前不拆宫格。');
    warnings.push('整层编辑默认 reference=editor 走 /v1/images/edits，待真实响应确认。');
  } else if (family === 'Nano Banana') {
    fields = [...fields, 'images'];
    nMax = 1;
    const docLimit = 9;
    const priceLimit = pricingImages || docLimit;
    maxReferenceImages = Math.min(docLimit, priceLimit);
    if (priceLimit !== docLimit) warnings.push('参考图上限资料冲突，保守按 9 记录。');
    declaredEdit = hasEdits && docHasImages;
    editRoute = declaredEdit ? 'edits' : 'none';
    if (pricingMask && !docHasMask) warnings.push('定价标 mask，模型页不支持；不发送 mask。');
  } else if (family === 'Seedream') {
    fields = [...fields, 'output_format', 'images'];
    outputFormats = outputPricing.length ? outputPricing : ['png', 'jpeg'];
    defaults.output_format = outputFormats.includes('png') ? 'png' : outputFormats[0]!;
    maxReferenceImages = Math.min(pricingImages || 10, 10);
    declaredEdit = hasEdits && docHasImages;
    editRoute = declaredEdit ? 'edits' : 'none';
    nMax = 1;
  } else if (family === 'FLUX') {
    fields = [...fields, 'images'];
    maxReferenceImages = 1;
    declaredEdit = hasEdits && docHasImages;
    editRoute = declaredEdit ? 'edits' : 'none';
    nMax = 1;
    warnings.push('仅在文档目录出现，未出现在公开定价。');
  }

  if (!hasGenerations) warnings.push('文档未声明文生图路由。');
  fields = [...new Set(fields.filter(f => f !== 'mask'))];

  const keyVisible = input.keyVisibleIds ? input.keyVisibleIds.includes(id) : null;
  const adapted = family !== 'Unknown';
  const editReady = adapted && declaredEdit && input.sourceUploadVerified;
  const publicListed = Boolean(pricing);
  const docsListed = true;

  return {
    id, family, catalog,
    fields, sizes: sizesPricing, qualities, speeds, outputFormats,
    nMin: 1, nMax, nativeCandidates, nativeCandidateShape, defaults,
    declaredText: hasGenerations,
    declaredEdit, editRoute, generateRoute, maxReferenceImages,
    maskDeclared: docHasMask || pricingMask,
    adapted, mockVerified: false, liveVerified: false, editReady,
    outputAlphaVerified: false, keyVisible, publicListed, docsListed,
    costFenUnknown: true,
    publicPriceHint: typeof pricing?.model_price === 'number' ? pricing.model_price : null,
    warnings,
    documentation: 'https://direct-api.cangyuansuanli.cn/docs-static/models/' + id + '.json',
    collectedAt: input.collectedAt
  };
}

export function assertFieldWhitelist(model: ModelInfo, options: Record<string, string | number | boolean>): void {
  for (const key of Object.keys(options)) {
    if (!model.fields.includes(key) && key !== 'alphaPolicy' && key !== 'mockMode') {
      throw new Error('FIELD_NOT_ALLOWED:' + key);
    }
  }
  if (typeof options.size === 'string' && model.sizes.length && !model.sizes.includes(options.size) && options.size !== 'auto') {
    throw new Error('FIELD_NOT_ALLOWED:size');
  }
  if (typeof options.quality === 'string' && model.qualities.length && !model.qualities.includes(options.quality)) {
    throw new Error('FIELD_NOT_ALLOWED:quality');
  }
  if (typeof options.speed === 'string' && model.speeds.length && !model.speeds.includes(options.speed)) {
    throw new Error('FIELD_NOT_ALLOWED:speed');
  }
}

export function mockModels(collectedAt: string): ModelInfo[] {
  const base = (id: string, extra: Partial<ModelInfo>): ModelInfo => ({
    id, family: 'Mock', catalog: 'public',
    fields: ['model', 'prompt', 'n', 'size', 'mockMode', 'async'],
    sizes: ['64x64', '128x96', '1:1'], qualities: [], speeds: [], outputFormats: ['png'],
    nMin: 1, nMax: 4, nativeCandidates: extra.nativeCandidates ?? 1, nativeCandidateShape: extra.nativeCandidateShape ?? 'separate-files',
    defaults: { n: 1, mockMode: 'identity', async: true },
    declaredText: true, declaredEdit: extra.declaredEdit ?? true,
    editRoute: extra.declaredEdit === false ? 'none' : 'edits',
    generateRoute: 'generations', maxReferenceImages: extra.declaredEdit === false ? 0 : 1,
    maskDeclared: false, adapted: true, mockVerified: true, liveVerified: false,
    editReady: extra.declaredEdit !== false, outputAlphaVerified: extra.outputAlphaVerified ?? true,
    keyVisible: true, publicListed: true, docsListed: true, costFenUnknown: false, publicPriceHint: 0,
    warnings: extra.warnings ?? [], documentation: 'mock://' + id, collectedAt,
    ...extra
  });
  return [
    base('mock-edit', { defaults: { n: 1, mockMode: 'invert', async: true } }),
    base('mock-identity', { defaults: { n: 1, mockMode: 'identity', async: true } }),
    base('mock-text', { declaredEdit: false, editReady: false, defaults: { n: 1, mockMode: 'text', async: true } }),
    base('mock-multi', { nativeCandidates: 4, nMax: 1, defaults: { n: 1, mockMode: 'multi', async: true } }),
    base('mock-fail', { defaults: { n: 1, mockMode: 'failure', async: true } }),
    base('mock-slow', { defaults: { n: 1, mockMode: 'slow', async: true } }),
    base('mock-late', { defaults: { n: 1, mockMode: 'late', async: true } }),
    base('mock-geometry', { defaults: { n: 1, mockMode: 'geometry', async: true } })
  ];
}
