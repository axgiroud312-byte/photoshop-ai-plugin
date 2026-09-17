import type { ApplyRecord, RawImage } from '../../contracts/src/application.js';
import { randomHex } from '../../contracts/src/sha256.js';
import { AppError } from '../../contracts/src/errors.js';
import { revalidateSnapshot } from './snapshot.js';
import type { ApplyRequest, ApplyResult, HostAdapter, ModalContext } from './types.js';

const appliedKeys = new Map<string, ApplyRecord>();

export function applyKey(documentOpenToken: string, candidateId: string): string {
  return documentOpenToken + ':' + candidateId;
}

export function rememberedApply(documentOpenToken: string, candidateId: string): ApplyRecord | undefined {
  return appliedKeys.get(applyKey(documentOpenToken, candidateId));
}

export function clearApplyMemory(): void { appliedKeys.clear(); }

function fail(ctx: ModalContext, stage: string): void {
  if (ctx.failAt === stage) throw new AppError(500, 'WRITEBACK_FAILED', '应用失败：' + stage);
}

export async function applyCandidate(host: HostAdapter, request: ApplyRequest): Promise<ApplyResult> {
  if (request.mode === 'text') return applyText(host, request);
  if (!request.snapshot) throw new AppError(400, 'INVALID_REQUEST', '整层应用缺少源快照。');
  const snapshot = request.snapshot;
  const existing = rememberedApply(snapshot.documentOpenToken, request.candidateId);
  if (existing?.applied && existing.resultLayerId !== null) {
    return { record: existing, resultLayerId: existing.resultLayerId };
  }

  return host.executeAsModal('AI 编辑：应用结果', async ctx => {
    const doc = await revalidateSnapshot(host, snapshot);
    const ui = await host.captureUi(doc.id);
    await ctx.suspendHistory('AI 编辑：应用结果');
    let createdId: number | null = null;
    try {
      fail(ctx, 'create');
      createdId = await host.createPixelLayer(doc.id, snapshot.parentLayerId, request.resultName, snapshot.layerId, true);
      fail(ctx, 'write');
      await host.writePixels(doc.id, createdId, request.image, snapshot.sourceRect);
      fail(ctx, 'move');
      await host.moveLayerAbove(doc.id, createdId, snapshot.layerId);
      fail(ctx, 'visibility');
      await host.setVisibility(doc.id, createdId, true);
      await host.setVisibility(doc.id, snapshot.layerId, false);
      await host.restoreUi(ui);
      if (ctx.isCancelled) throw new AppError(409, 'USER_CANCELLED', '已停止本插件等待；上游可能仍计费。');
      await ctx.resumeHistory(true);
      const record: ApplyRecord = {
        applyId: 'apply_' + randomHex(8),
        jobId: request.candidateId,
        candidateId: request.candidateId,
        resultLayerId: createdId,
        historyName: 'AI 编辑：应用结果',
        applied: true
      };
      appliedKeys.set(applyKey(snapshot.documentOpenToken, request.candidateId), record);
      return { record, resultLayerId: createdId };
    } catch (error) {
      if (createdId !== null) {
        try { await host.setVisibility(doc.id, snapshot.layerId, true); } catch { /* rollback best-effort */ }
      }
      try { await ctx.resumeHistory(false); } catch { /* host rolls back on modal failure */ }
      throw error;
    }
  });
}

async function applyText(host: HostAdapter, request: ApplyRequest): Promise<ApplyResult> {
  const existing = rememberedApply(String(request.documentId), request.candidateId);
  if (existing?.applied && existing.resultLayerId !== null) {
    return { record: existing, resultLayerId: existing.resultLayerId };
  }
  const doc = await host.getDocument(request.documentId);
  if (!doc) throw new AppError(409, 'TARGET_CLOSED', '原文档已关闭。');
  const visibilities = new Map(doc.layers.map(layer => [layer.id, layer.visible]));
  const placed = containCenter(request.image, doc.width, doc.height);

  return host.executeAsModal('AI 生图：应用结果', async ctx => {
    const ui = await host.captureUi(doc.id);
    await ctx.suspendHistory('AI 生图：应用结果');
    let createdId: number | null = null;
    try {
      createdId = await host.createPixelLayer(doc.id, null, request.resultName, null, true);
      await host.writePixels(doc.id, createdId, placed.image, placed.at);
      await host.setVisibility(doc.id, createdId, true);
      for (const [id, visible] of visibilities) {
        if (id !== createdId) await host.setVisibility(doc.id, id, visible);
      }
      await host.restoreUi(ui);
      await ctx.resumeHistory(true);
      const record: ApplyRecord = {
        applyId: 'apply_' + randomHex(8),
        jobId: request.candidateId,
        candidateId: request.candidateId,
        resultLayerId: createdId,
        historyName: 'AI 生图：应用结果',
        applied: true
      };
      appliedKeys.set(applyKey(String(request.documentId), request.candidateId), record);
      return { record, resultLayerId: createdId };
    } catch (error) {
      try { await ctx.resumeHistory(false); } catch { /* host rolls back */ }
      throw error;
    }
  });
}

function containCenter(image: RawImage, canvasW: number, canvasH: number): { image: RawImage; at: { left: number; top: number; width: number; height: number } } {
  const scale = Math.min(canvasW / image.width, canvasH / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const left = Math.floor((canvasW - width) / 2);
  const top = Math.floor((canvasH - height) / 2);
  const pixels = scale === 1 ? image.pixels : resample(image.pixels, image.width, image.height, width, height);
  return {
    image: { ...image, width, height, pixels },
    at: { left, top, width, height }
  };
}

function resample(pixels: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.round(y * (srcH / dstH)));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.round(x * (srcW / dstW)));
      out.set(pixels.subarray((srcY * srcW + srcX) * 4, (srcY * srcW + srcX) * 4 + 4), (y * dstW + x) * 4);
    }
  }
  return out;
}

export async function canUseDedicatedUndo(host: HostAdapter, documentId: number, historyName: string): Promise<boolean> {
  return host.historyTopIs(documentId, historyName);
}
