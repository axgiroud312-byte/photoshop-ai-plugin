import { AppError } from '../../contracts/src/errors.js';
import { COLOR_PROFILE } from '../../contracts/src/pixels.js';
import type { HostDocument, HostLayer } from './types.js';

const SIMPLE_BLEND = new Set(['normal', 'NORMAL', 'passThrough', 'PASS_THROUGH']);

export function assertDocumentEligible(doc: HostDocument): void {
  if (doc.mode !== 'RGB') throw new AppError(400, 'UNSUPPORTED_DOCUMENT', '当前文档不是 RGB 模式。');
  if (doc.bitsPerChannel !== 8) throw new AppError(400, 'UNSUPPORTED_DOCUMENT', '当前文档不是 8 位/通道。');
  if (doc.profile !== COLOR_PROFILE) throw new AppError(400, 'UNSUPPORTED_DOCUMENT', '当前文档未嵌入 sRGB 配置文件。');
  if (doc.pixelAspect !== 1) throw new AppError(400, 'UNSUPPORTED_DOCUMENT', '当前文档使用非方形像素。');
  if (doc.quickMask) throw new AppError(400, 'UNSUPPORTED_DOCUMENT', '请先退出快速蒙版。');
  if (doc.activeChannel !== 'composite') {
    throw new AppError(400, 'UNSUPPORTED_DOCUMENT', '请回到复合通道后再编辑。');
  }
}

export function assertLayerEligible(doc: HostDocument, layer: HostLayer): void {
  if (layer.kind !== 'pixel') throw new AppError(400, 'UNSUPPORTED_LAYER', '请选择一个普通像素图层。');
  if (layer.isBackground) throw new AppError(400, 'UNSUPPORTED_LAYER', '背景专用层不受支持，请先复制为普通像素层。');
  if (layer.locked) throw new AppError(400, 'UNSUPPORTED_LAYER', '图层已锁定。');
  if (layer.hasMask) throw new AppError(400, 'UNSUPPORTED_LAYER', '此层包含蒙版，v0.1 暂不支持直接编辑。');
  if (layer.hasEffects) throw new AppError(400, 'UNSUPPORTED_LAYER', '此层包含图层效果，v0.1 暂不支持直接编辑。');
  if (layer.clipped) throw new AppError(400, 'UNSUPPORTED_LAYER', '剪贴层不受支持。');
  if (layer.opacity !== 100 || layer.fillOpacity !== 100) {
    throw new AppError(400, 'UNSUPPORTED_LAYER', '请使用 100% 不透明度与填充的图层。');
  }
  if (!SIMPLE_BLEND.has(layer.blendMode)) {
    throw new AppError(400, 'UNSUPPORTED_LAYER', '仅支持普通混合模式。');
  }
  if (layer.empty) throw new AppError(400, 'EMPTY_LAYER', '当前图层没有可编辑像素。');
  if (layer.bounds.left < 0 || layer.bounds.top < 0
    || layer.bounds.left + layer.bounds.width > doc.width
    || layer.bounds.top + layer.bounds.height > doc.height) {
    throw new AppError(400, 'OUT_OF_CANVAS_UNSUPPORTED', '图层越出画布，本版本不截断不可见内容。');
  }
  let parent = layer.parentId === null ? undefined : doc.layers.find(item => item.id === layer.parentId);
  while (parent) {
    if (parent.kind !== 'group') throw new AppError(400, 'UNSUPPORTED_LAYER', '复杂祖先组不受支持。');
    if (parent.hasMask || parent.hasEffects || parent.clipped || parent.locked) {
      throw new AppError(400, 'UNSUPPORTED_LAYER', '祖先组包含蒙版、效果、剪贴或锁定，已拒绝。');
    }
    parent = parent.parentId === null ? undefined : doc.layers.find(item => item.id === parent!.parentId);
  }
}

export function selectedPixelLayer(doc: HostDocument, selectedIds: number[]): HostLayer {
  if (selectedIds.length !== 1) throw new AppError(400, 'INVALID_LAYER_SELECTION', '请只选择一个普通像素图层。');
  const layer = doc.layers.find(item => item.id === selectedIds[0]);
  if (!layer) throw new AppError(400, 'INVALID_LAYER_SELECTION', '请只选择一个普通像素图层。');
  return layer;
}
