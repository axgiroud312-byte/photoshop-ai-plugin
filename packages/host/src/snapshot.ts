import { canonicalSha256 } from '../../contracts/src/pixels.js';
import { sha256Hex } from '../../contracts/src/sha256.js';
import type { SourceSnapshot } from '../../contracts/src/application.js';
import { AppError } from '../../contracts/src/errors.js';
import { assertDocumentEligible, assertLayerEligible } from './eligibility.js';
import type { HostAdapter, HostDocument, HostLayer, PixelObject } from './types.js';

export function structureHash(doc: HostDocument, layer: HostLayer): string {
  const siblings = doc.layers.filter(item => item.parentId === layer.parentId)
    .sort((a, b) => a.indexInParent - b.indexInParent)
    .map(item => [item.id, item.kind, item.visible, item.clipped, item.hasMask, item.hasEffects]);
  return sha256Hex(JSON.stringify({
    document: { id: doc.id, openToken: doc.openToken, width: doc.width, height: doc.height, profile: doc.profile, mode: doc.mode, bits: doc.bitsPerChannel },
    layer: { id: layer.id, kind: layer.kind, parentId: layer.parentId, blend: layer.blendMode, opacity: layer.opacity, fill: layer.fillOpacity, mask: layer.hasMask, effects: layer.hasEffects, clipped: layer.clipped, locked: layer.locked },
    siblings
  }));
}

function padToRequested(read: PixelObject, requested: { left: number; top: number; width: number; height: number }): Uint8Array {
  if (read.level !== 0) throw new AppError(500, 'OUTPUT_INVALID', '像素读取不是完整分辨率。');
  const out = new Uint8Array(requested.width * requested.height * 4);
  for (let y = 0; y < read.bounds.height; y++) {
    const destY = read.bounds.top - requested.top + y;
    if (destY < 0 || destY >= requested.height) continue;
    for (let x = 0; x < read.bounds.width; x++) {
      const destX = read.bounds.left - requested.left + x;
      if (destX < 0 || destX >= requested.width) continue;
      const si = (y * read.bounds.width + x) * 4;
      const di = (destY * requested.width + destX) * 4;
      out[di] = read.pixels[si]!;
      out[di + 1] = read.pixels[si + 1]!;
      out[di + 2] = read.pixels[si + 2]!;
      out[di + 3] = read.pixels[si + 3]!;
    }
  }
  return out;
}

export async function captureSource(
  host: HostAdapter,
  doc: HostDocument,
  layer: HostLayer
): Promise<{ snapshot: SourceSnapshot; pixels: Uint8Array }> {
  assertDocumentEligible(doc);
  assertLayerEligible(doc, layer);
  const requested = layer.bounds;
  const read = await host.getPixels(doc.id, layer.id, requested);
  try {
    const pixels = padToRequested(read, requested);
    const siblings = doc.layers.filter(item => item.parentId === layer.parentId)
      .sort((a, b) => a.indexInParent - b.indexInParent);
    const index = siblings.findIndex(item => item.id === layer.id);
    const snapshot: SourceSnapshot = {
      photoshopSessionId: host.sessionId,
      documentOpenToken: doc.openToken,
      documentId: doc.id,
      layerId: layer.id,
      parentLayerId: layer.parentId,
      siblingAboveId: index >= 0 && siblings[index + 1] ? siblings[index + 1]!.id : null,
      siblingBelowId: index > 0 ? siblings[index - 1]!.id : null,
      sourceRect: { ...requested },
      documentSize: { width: doc.width, height: doc.height },
      documentProfile: 'sRGB IEC61966-2.1',
      sourcePixelHash: canonicalSha256(pixels),
      structureHash: structureHash(doc, layer),
      historyStateId: doc.historyLength,
      sourceWasVisible: true,
      sourceName: layer.name,
      documentName: doc.name,
      capturedAt: new Date().toISOString()
    };
    return { snapshot, pixels };
  } finally {
    read.dispose();
  }
}

export async function revalidateSnapshot(host: HostAdapter, snapshot: SourceSnapshot): Promise<HostDocument> {
  if (host.sessionId !== snapshot.photoshopSessionId) {
    throw new AppError(409, 'TARGET_CLOSED', 'Photoshop 会话已变化，不能使用旧任务。');
  }
  const doc = await host.getDocument(snapshot.documentId);
  if (!doc || doc.openToken !== snapshot.documentOpenToken) {
    throw new AppError(409, 'TARGET_CLOSED', '原文档已关闭，不能按旧 ID 写入。');
  }
  assertDocumentEligible(doc);
  const layer = doc.layers.find(item => item.id === snapshot.layerId);
  if (!layer) throw new AppError(409, 'SOURCE_CHANGED', '原目标图层已不存在。');
  assertLayerEligible(doc, layer);
  if (layer.parentId !== snapshot.parentLayerId
    || layer.bounds.left !== snapshot.sourceRect.left
    || layer.bounds.top !== snapshot.sourceRect.top
    || layer.bounds.width !== snapshot.sourceRect.width
    || layer.bounds.height !== snapshot.sourceRect.height
    || structureHash(doc, layer) !== snapshot.structureHash) {
    throw new AppError(409, 'SOURCE_CHANGED', '原目标已变化，暂不能应用。');
  }
  const read = await host.getPixels(doc.id, layer.id, snapshot.sourceRect);
  try {
    const pixels = padToRequested(read, snapshot.sourceRect);
    if (canonicalSha256(pixels) !== snapshot.sourcePixelHash) {
      throw new AppError(409, 'SOURCE_CHANGED', '源图层像素已变化，暂不能应用。');
    }
  } finally {
    read.dispose();
  }
  return doc;
}
