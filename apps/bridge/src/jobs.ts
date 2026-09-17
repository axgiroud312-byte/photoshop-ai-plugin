import { createHash, randomBytes } from 'node:crypto';
import type { JobInfo, JobRequest, JobStatus } from '../../../packages/contracts/src/application.js';
import { AppError } from '../../../packages/contracts/src/errors.js';
import type { CatalogSnapshot } from '../../../packages/contracts/src/application.js';
import { findModel } from '../../../packages/catalog/src/refresh.js';
import { assertFieldWhitelist } from '../../../packages/catalog/src/adapt.js';
import type { BudgetLedger } from './budget.js';
import type { ImageProvider } from './providers/types.js';

interface InternalJob {
  info: JobInfo;
  digest: string;
  controller: AbortController;
  running: Promise<void>;
}

export class JobManager {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly byClient = new Map<string, string>();
  private activeId: string | null = null;

  constructor(
    private readonly provider: () => ImageProvider,
    private readonly catalog: () => CatalogSnapshot,
    private readonly budget: BudgetLedger,
    private readonly sourceUploadVerified: () => boolean
  ) {}

  listActive(): number { return this.activeId ? 1 : 0; }

  get(id: string): JobInfo {
    const job = this.jobs.get(id);
    if (!job) throw new AppError(404, 'NOT_FOUND', '找不到该任务。');
    return publicJob(job.info);
  }

  create(request: JobRequest, live: boolean): JobInfo {
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const existingId = this.byClient.get(request.clientRequestId);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (!existing) throw new AppError(500, 'INTERNAL', '幂等任务丢失。');
      if (existing.digest !== digest) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '同一请求编号携带了不同内容。');
      return publicJob(existing.info);
    }
    if (this.activeId) {
      const active = this.jobs.get(this.activeId);
      if (active && !isTerminal(active.info.status)) {
        throw new AppError(409, 'BUSY', '已有一个活动生成任务。');
      }
    }
    const model = findModel(this.catalog(), request.model);
    if (!model) throw new AppError(400, 'MODEL_NOT_ADAPTED', '未知模型。');
    if (!model.adapted) throw new AppError(409, 'MODEL_NOT_ADAPTED', '该模型尚未适配，不能发送。');
    if (request.mode === 'layer' && !model.declaredEdit) {
      throw new AppError(400, 'EDIT_NOT_AVAILABLE', '当前模型仅支持文字生图。');
    }
    if (request.mode === 'text' && !model.declaredText) {
      throw new AppError(400, 'TEXT_NOT_AVAILABLE', '当前模型不支持文字生图。');
    }
    if (request.mode === 'layer' && live && !this.sourceUploadVerified()) {
      throw new AppError(409, 'SOURCE_UPLOAD_UNVERIFIED', '本地图层传输契约尚未验证。');
    }
    try { assertFieldWhitelist(model, request.options); } catch {
      throw new AppError(400, 'FIELD_NOT_ALLOWED', '参数不属于该模型白名单。');
    }
    if (request.n < model.nMin || request.n > model.nMax) {
      throw new AppError(400, 'INVALID_REQUEST', '候选数量超出该模型允许范围。');
    }
    if (live) {
      throw new AppError(402, 'COST_UNKNOWN', '尚未核对人民币计价单位，不能发起真实付费调用。');
    }

    const info: JobInfo = {
      id: 'job_' + randomBytes(10).toString('hex'),
      clientRequestId: request.clientRequestId,
      mode: request.mode,
      model: request.model,
      status: 'queued',
      stage: 'queued',
      waitedMs: 0,
      candidates: [],
      selectedIndex: null,
      createdAt: new Date().toISOString(),
      warnings: model.warnings.slice(),
      costFenReserved: live ? 0 : 0,
      costFenSettled: live ? null : 0
    };
    const controller = new AbortController();
    const internal: InternalJob = { info, digest, controller, running: Promise.resolve() };
    this.jobs.set(info.id, internal);
    this.byClient.set(request.clientRequestId, info.id);
    this.activeId = info.id;
    if (live) this.budget.reserve(info.id, 0, true);
    internal.running = this.run(internal, request);
    return publicJob(info);
  }

  cancel(id: string): JobInfo {
    const job = this.jobs.get(id);
    if (!job) throw new AppError(404, 'NOT_FOUND', '找不到该任务。');
    if (job.info.status === 'unknown') return publicJob(job.info);
    if (isTerminal(job.info.status)) return publicJob(job.info);
    job.controller.abort();
    job.info.status = 'cancelled';
    job.info.stage = 'cancelled';
    if (this.activeId === id) this.activeId = null;
    return publicJob(job.info);
  }

  private async run(job: InternalJob, request: JobRequest): Promise<void> {
    const started = Date.now();
    try {
      job.info.status = 'in_progress';
      job.info.stage = 'submitting';
      const submit = toSubmit(job, request, this.catalog());
      const handle = await this.provider().submit(submit);
      if (handle.providerTaskId) job.info.providerTaskId = handle.providerTaskId;
      if (handle.submitPath) job.info.submitPath = handle.submitPath;
      if (currentStatus(job) === 'cancelled') return;
      job.info.stage = 'waiting-model';
      const result = await this.provider().poll(submit, handle);
      if (currentStatus(job) === 'cancelled') return;
      if (result.status === 'unknown') {
        job.info.status = 'unknown';
        job.info.stage = 'unknown';
        job.info.error = result.error ?? { code: 'REQUEST_STATUS_UNKNOWN', message: '上游状态不确定。', retryable: false };
        this.budget.markUnknown(job.info.id);
        return;
      }
      job.info.candidates = result.candidates;
      job.info.status = 'completed';
      job.info.stage = 'ready';
      job.info.costFenSettled = result.settledFen;
      if (result.geometry) job.info.geometry = result.geometry;
      this.budget.settle(job.info.id, result.settledFen);
    } catch (error) {
      if (currentStatus(job) === 'cancelled') return;
      const app = error instanceof AppError ? error : new AppError(500, 'INTERNAL', '任务失败。');
      if (app.code === 'USER_CANCELLED') {
        job.info.status = 'cancelled';
        job.info.stage = 'cancelled';
        return;
      }
      job.info.status = 'failed';
      job.info.stage = 'failed';
      job.info.error = { code: app.code, message: app.message, retryable: app.retryable };
    } finally {
      job.info.waitedMs = Date.now() - started;
      if (this.activeId === job.info.id && isTerminal(job.info.status)) this.activeId = null;
    }
  }
}

function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'unknown';
}

function currentStatus(job: InternalJob): JobStatus {
  return job.info.status;
}

function toSubmit(job: InternalJob, request: JobRequest, catalog: CatalogSnapshot): import('./providers/types.js').ProviderSubmit {
  const model = findModel(catalog, request.model);
  if (!model) throw new AppError(400, 'MODEL_NOT_ADAPTED', '未知模型。');
  const submit: import('./providers/types.js').ProviderSubmit = {
    jobId: job.info.id,
    clientRequestId: request.clientRequestId,
    mode: request.mode,
    model,
    prompt: request.prompt,
    alphaPolicy: request.alphaPolicy,
    n: request.n,
    options: request.options,
    signal: job.controller.signal
  };
  if (request.sourceAssetId !== undefined) submit.sourceAssetId = request.sourceAssetId;
  return submit;
}

function publicJob(info: JobInfo): JobInfo {
  return structuredClone(info);
}
