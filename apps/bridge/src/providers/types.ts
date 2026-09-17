import type { AlphaPolicy, Candidate, GeometryMapping, WorkMode } from '../../../../packages/contracts/src/application.js';
import type { ModelInfo } from '../../../../packages/contracts/src/application.js';

export interface ProviderSubmit {
  jobId: string;
  clientRequestId: string;
  mode: WorkMode;
  model: ModelInfo;
  prompt: string;
  sourceAssetId?: string;
  alphaPolicy: AlphaPolicy;
  n: number;
  options: Record<string, string | number | boolean>;
  signal: AbortSignal;
}

export interface ProviderResult {
  status: 'completed' | 'failed' | 'unknown';
  providerTaskId?: string;
  submitPath?: string;
  candidates: Candidate[];
  geometry?: GeometryMapping;
  error?: { code: string; message: string; retryable: boolean };
  settledFen: number;
}

export interface ImageProvider {
  readonly kind: 'mock' | 'cangyuan';
  submit(request: ProviderSubmit): Promise<{ providerTaskId?: string; submitPath?: string }>;
  poll(request: ProviderSubmit, handle: { providerTaskId?: string; submitPath?: string }): Promise<ProviderResult>;
}
