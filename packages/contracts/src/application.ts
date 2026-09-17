import { MAX_EDGE, MAX_PIXELS } from './pixels.js';

export const PROTOCOL_VERSION = 'photoshop-ai/0.1';
export const BRIDGE_HOST = '127.0.0.1';
export const BRIDGE_PORT = 47833;
export const BUDGET_LIMIT_FEN = 3000;
export const ASPECT_TOLERANCE = 0.005;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;
export const MAX_ENCODED_BYTES = 32 * 1024 * 1024;
export const MAX_STORE_BYTES = 512 * 1024 * 1024;
export const ASSET_TTL_MS = 24 * 60 * 60 * 1000;
export const JSON_BODY_LIMIT = 1024 * 1024;
export const MAX_DOWNLOAD_REDIRECTS = 3;
export const PREVIEW_MAX_EDGE = 256;
export { MAX_EDGE, MAX_PIXELS };

export type WorkMode = 'layer' | 'text';
export type AlphaPolicy = 'preserve-source' | 'use-model';
export type ProviderKind = 'mock' | 'cangyuan';
export type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export type CatalogKind = 'public' | 'documentation-only' | 'new-unadapted';
export type CheckLevel = 'format' | 'auth' | 'live-image';
export type EvidenceKind = 'mock' | 'browser-demo' | 'uxp' | 'live-model';
export type NativeCandidateShape = 'unknown' | 'separate-files' | 'grid';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RawImage {
  width: number;
  height: number;
  channels: 4;
  componentSize: 8;
  colorProfile: 'sRGB IEC61966-2.1';
  alphaMode: 'straight';
  pixels: Uint8Array;
}

export interface AssetInfo {
  id: string;
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  kind: 'source' | 'result' | 'preview' | 'export';
}

export interface GeometryMapping {
  sourceWidth: number;
  sourceHeight: number;
  requestWidth: number;
  requestHeight: number;
  contentRect: Rect;
  scaleX: number;
  scaleY: number;
  returnedWidth: number;
  returnedHeight: number;
}

export interface DynamicField {
  name: string;
  values: Array<string | number | boolean>;
  required: boolean;
}

export interface ModelInfo {
  id: string;
  family: string;
  catalog: CatalogKind;
  fields: string[];
  sizes: string[];
  qualities: string[];
  speeds: string[];
  outputFormats: string[];
  nMin: number;
  nMax: number;
  nativeCandidates: number;
  nativeCandidateShape: NativeCandidateShape;
  defaults: Record<string, string | number | boolean>;
  declaredText: boolean;
  declaredEdit: boolean;
  editRoute: 'edits' | 'generations' | 'none';
  generateRoute: 'generations' | 'none';
  maxReferenceImages: number;
  maskDeclared: boolean;
  adapted: boolean;
  mockVerified: boolean;
  liveVerified: boolean;
  editReady: boolean;
  outputAlphaVerified: boolean;
  keyVisible: boolean | null;
  publicListed: boolean;
  docsListed: boolean;
  costFenUnknown: boolean;
  publicPriceHint: number | null;
  warnings: string[];
  documentation: string;
  collectedAt: string;
}

export interface CatalogSnapshot {
  collectedAt: string;
  collectedAtLocal: string;
  source: 'baseline-cache' | 'live-refresh';
  pricingHash: string;
  docsHash: string;
  keyListHash: string | null;
  models: ModelInfo[];
  unadaptedIds: string[];
  releaseBlocked: boolean;
  notes: string[];
}

export interface JobRequest {
  clientRequestId: string;
  mode: WorkMode;
  model: string;
  prompt: string;
  sourceAssetId?: string;
  alphaPolicy: AlphaPolicy;
  n: number;
  options: Record<string, string | number | boolean>;
}

export interface Candidate extends AssetInfo {
  label: string;
  warnings: string[];
  previewAssetId: string;
  exportAssetId: string;
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobInfo {
  id: string;
  clientRequestId: string;
  mode: WorkMode;
  model: string;
  status: JobStatus;
  stage: string;
  waitedMs: number;
  candidates: Candidate[];
  selectedIndex: number | null;
  error?: JobError;
  createdAt: string;
  providerTaskId?: string;
  submitPath?: string;
  geometry?: GeometryMapping;
  warnings: string[];
  costFenReserved: number;
  costFenSettled: number | null;
}

export interface ServiceConfig {
  provider: ProviderKind;
  hasApiKey: boolean;
  liveEnabled: boolean;
  formatChecked: boolean;
  authChecked: boolean;
  liveImageVerified: boolean;
  spentFen: number;
  reservedFen: number;
  spentAndReservedFen: number;
  budgetLimitFen: typeof BUDGET_LIMIT_FEN;
  sourceUploadVerified: false;
  revision: number;
  catalogCollectedAt: string;
  catalogSource: CatalogSnapshot['source'];
}

export interface SourceSnapshot {
  photoshopSessionId: string;
  documentOpenToken: string;
  documentId: number;
  layerId: number;
  parentLayerId: number | null;
  siblingAboveId: number | null;
  siblingBelowId: number | null;
  sourceRect: Rect;
  documentSize: { width: number; height: number };
  documentProfile: 'sRGB IEC61966-2.1';
  sourcePixelHash: string;
  structureHash: string;
  historyStateId: number | null;
  sourceWasVisible: true;
  sourceName: string;
  documentName: string;
  capturedAt: string;
}

export interface ApplyRecord {
  applyId: string;
  jobId: string;
  candidateId: string;
  resultLayerId: number | null;
  historyName: string;
  applied: boolean;
}
