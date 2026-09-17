import type { RawImage, Rect } from '../../../packages/contracts/src/application.js';
import { AppError } from '../../../packages/contracts/src/errors.js';
import type { HostAdapter, HostDocument, HostLayer, LayerKind, ModalContext, PixelObject, UiState } from '../../../packages/host/src/types.js';

interface PsLayer {
  id: number;
  name: string;
  kind?: unknown;
  visible?: boolean;
  locked?: unknown;
  bounds?: { left: number; top: number; right?: number; bottom?: number; width?: number; height?: number };
  opacity?: number;
  fillOpacity?: number;
  blendMode?: unknown;
  isBackgroundLayer?: boolean;
  clipped?: boolean;
  isClippingMasked?: boolean;
  layerMask?: unknown;
  vectorMask?: unknown;
  filterMask?: unknown;
  layerEffects?: unknown;
  layers?: PsLayer[] | { length: number; [index: number]: PsLayer };
}

interface PsDoc {
  id: number;
  title: string;
  width: number | { value?: number };
  height: number | { value?: number };
  bitsPerChannel?: unknown;
  mode?: unknown;
  colorProfileName?: string;
  pixelAspectRatio?: number;
  layers?: PsLayer[] | { length: number; [index: number]: PsLayer };
  activeLayers?: Array<{ id: number }>;
  historyStates?: Array<{ name: string }> | { length: number; [index: number]: { name: string } };
  createLayer?: (opts: { name: string }) => Promise<{ id: number; visible: boolean }>;
}

type Ps = typeof import('photoshop') & {
  action?: { batchPlay: (commands: unknown[], opts: unknown) => Promise<Array<Record<string, unknown>>> };
  app: {
    version?: string;
    activeDocument?: PsDoc;
    documents: PsDoc[] | { length: number; [index: number]: PsDoc };
  };
};

function listOf<T>(collection: T[] | { length: number; [index: number]: T } | undefined): T[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  const out: T[] = [];
  for (let i = 0; i < collection.length; i++) out.push(collection[i]!);
  return out;
}

function numberOf(value: number | { value?: number } | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && typeof value.value === 'number') return value.value;
  return fallback;
}

function rectFrom(bounds: PsLayer['bounds']): Rect {
  if (!bounds) return { left: 0, top: 0, width: 1, height: 1 };
  const left = bounds.left;
  const top = bounds.top;
  const width = bounds.width ?? ((bounds.right ?? left) - left);
  const height = bounds.height ?? ((bounds.bottom ?? top) - top);
  return { left, top, width, height };
}

function mapKind(layer: PsLayer): LayerKind {
  if (layer.isBackgroundLayer) return 'background';
  const kind = String(layer.kind ?? '').toLowerCase();
  if (kind.includes('group') || kind.includes('section')) return 'group';
  if (kind.includes('smart')) return 'smartObject';
  if (kind.includes('text') || kind.includes('type')) return 'text';
  if (kind.includes('adjust') || kind.includes('bright') || kind.includes('hue') || kind.includes('curve')) return 'adjustment';
  if (kind.includes('shape') || kind.includes('fill') || kind.includes('solid') || kind.includes('gradient')) return 'shape';
  if (kind.includes('pixel') || kind.includes('normal') || kind === '1') return 'pixel';
  if (listOf(layer.layers).length > 0) return 'group';
  return kind ? 'other' : 'pixel';
}

function isLocked(locked: unknown): boolean {
  if (locked === true) return true;
  if (locked && typeof locked === 'object') {
    const record = locked as { all?: boolean; position?: boolean; pixels?: boolean };
    return Boolean(record.all || record.pixels);
  }
  return false;
}

function copyPixels(data: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data.slice();
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return new Uint8Array(data.slice(0));
}

function walkLayers(collection: PsLayer[] | { length: number; [index: number]: PsLayer } | undefined, parentId: number | null, out: HostLayer[]): void {
  const layers = listOf(collection);
  layers.forEach((layer, index) => {
    const kind = mapKind(layer);
    const bounds = rectFrom(layer.bounds);
    out.push({
      id: layer.id,
      name: layer.name,
      kind,
      parentId,
      indexInParent: index,
      visible: layer.visible !== false,
      locked: isLocked(layer.locked),
      opacity: typeof layer.opacity === 'number' ? layer.opacity : 100,
      fillOpacity: typeof layer.fillOpacity === 'number' ? layer.fillOpacity : 100,
      blendMode: String(layer.blendMode ?? 'normal'),
      bounds,
      hasMask: Boolean(layer.layerMask || layer.vectorMask || layer.filterMask),
      hasEffects: Boolean(layer.layerEffects),
      clipped: Boolean(layer.clipped || layer.isClippingMasked),
      isBackground: Boolean(layer.isBackgroundLayer),
      empty: bounds.width <= 0 || bounds.height <= 0
    });
    walkLayers(layer.layers, layer.id, out);
  });
}

function mapDocument(doc: PsDoc, sessionId: string): HostDocument {
  const layers: HostLayer[] = [];
  walkLayers(doc.layers, null, layers);
  const history = listOf(doc.historyStates);
  const bits = String(doc.bitsPerChannel ?? '8').toLowerCase();
  const mode = String(doc.mode ?? 'RGB').toLowerCase();
  const profile = doc.colorProfileName ?? 'sRGB IEC61966-2.1';
  return {
    id: doc.id,
    name: doc.title,
    openToken: sessionId + ':' + doc.id,
    width: numberOf(doc.width, 0),
    height: numberOf(doc.height, 0),
    mode: mode.includes('cmyk') ? 'CMYK' : mode.includes('lab') ? 'Lab' : mode.includes('gray') ? 'Grayscale' : mode.includes('rgb') ? 'RGB' : 'other',
    bitsPerChannel: bits.includes('16') ? 16 : bits.includes('32') ? 32 : 8,
    profile,
    pixelAspect: typeof doc.pixelAspectRatio === 'number' ? doc.pixelAspectRatio : 1,
    layers,
    selection: null,
    activeChannel: 'composite',
    activeLayerId: doc.activeLayers?.[0]?.id ?? null,
    quickMask: false,
    historyTopName: history.at(-1)?.name ?? null,
    historyLength: history.length
  };
}

export class PhotoshopHost implements HostAdapter {
  sessionId = 'uxp-' + Date.now();
  hostVersion: string;
  constructor(private readonly ps: Ps) {
    this.hostVersion = String(ps.app.version ?? 'unknown');
  }

  async listDocuments(): Promise<HostDocument[]> {
    return listOf(this.ps.app.documents).map(doc => mapDocument(doc, this.sessionId));
  }

  async getDocument(id: number): Promise<HostDocument | null> {
    const docs = await this.listDocuments();
    return docs.find(doc => doc.id === id) ?? null;
  }

  async getPixels(documentId: number, layerId: number, requested: Rect): Promise<PixelObject> {
    const result = await this.ps.imaging.getPixels({
      documentID: documentId, layerID: layerId, applyAlpha: false, componentSize: 8,
      sourceBounds: {
        left: requested.left, top: requested.top,
        right: requested.left + requested.width, bottom: requested.top + requested.height
      }
    });
    const bounds = {
      left: result.sourceBounds.left, top: result.sourceBounds.top,
      width: result.sourceBounds.right - result.sourceBounds.left,
      height: result.sourceBounds.bottom - result.sourceBounds.top
    };
    const data = result.imageData as { getData?: () => Promise<ArrayBuffer | Uint8Array> | ArrayBuffer | Uint8Array; dispose: () => void };
    const buffer = data.getData ? await data.getData() : new ArrayBuffer(0);
    const pixels = copyPixels(buffer);
    let disposed = false;
    return {
      bounds, level: result.level, pixels, disposed,
      dispose: () => { if (!disposed) { disposed = true; result.imageData.dispose(); } }
    };
  }

  async executeAsModal<T>(commandName: string, fn: (ctx: ModalContext) => Promise<T>): Promise<T> {
    return this.ps.core.executeAsModal(async execution => {
      let suspension: unknown;
      const ctx: ModalContext = {
        isCancelled: execution.isCancelled,
        suspendHistory: async name => {
          const doc = this.ps.app.activeDocument;
          if (!doc) throw new AppError(400, 'NO_DOCUMENT', '请先打开一个 Photoshop 文档。');
          suspension = await execution.hostControl.suspendHistory({ documentID: doc.id, name });
        },
        resumeHistory: async commit => {
          if (suspension) await execution.hostControl.resumeHistory(suspension, commit);
        }
      };
      return fn(ctx);
    }, { commandName }) as Promise<T>;
  }

  async createPixelLayer(documentId: number, parentId: number | null, name: string, _belowLayerId: number | null, hidden: boolean): Promise<number> {
    const doc = this.ps.app.activeDocument;
    if (doc && typeof doc.createLayer === 'function') {
      const layer = await doc.createLayer({ name });
      if (hidden) await this.setVisibility(documentId, layer.id, false);
      if (parentId !== null) {
        await this.batch([{
          _obj: 'move',
          _target: [{ _ref: 'layer', _id: layer.id }],
          to: { _ref: 'layer', _id: parentId, _enum: 'ordinal', _value: 'inside' }
        }]);
      }
      return layer.id;
    }
    const result = await this.batch([{ _obj: 'make', _target: [{ _ref: 'layer' }], using: { _obj: 'layer', name } }]);
    const id = Number(result[0]?.layerID ?? result[0]?.ID);
    if (!Number.isFinite(id)) throw new AppError(500, 'WRITEBACK_FAILED', '无法创建结果图层。');
    if (hidden) await this.setVisibility(documentId, id, false);
    if (parentId !== null) {
      await this.batch([{
        _obj: 'move',
        _target: [{ _ref: 'layer', _id: id }],
        to: { _ref: 'layer', _id: parentId, _enum: 'ordinal', _value: 'inside' }
      }]);
    }
    return id;
  }

  async writePixels(documentId: number, layerId: number, image: RawImage, at: Rect): Promise<void> {
    const imageData = await this.ps.imaging.createImageDataFromBuffer(image.pixels, {
      width: image.width, height: image.height, components: 4, chunky: true,
      colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1'
    });
    try {
      await this.ps.imaging.putPixels({
        documentID: documentId, layerID: layerId, imageData, replace: true,
        targetBounds: { left: at.left, top: at.top }
      });
    } finally {
      imageData.dispose();
    }
  }

  async setVisibility(_documentId: number, layerId: number, visible: boolean): Promise<void> {
    await this.batch([{ _obj: visible ? 'show' : 'hide', _target: [{ _ref: 'layer', _id: layerId }] }]);
  }

  async moveLayerAbove(_documentId: number, layerId: number, targetId: number): Promise<void> {
    await this.batch([{
      _obj: 'move',
      _target: [{ _ref: 'layer', _id: layerId }],
      to: { _ref: 'layer', _id: targetId },
      adjustment: false
    }]);
  }

  async captureUi(documentId: number): Promise<UiState> {
    const doc = this.ps.app.activeDocument;
    return {
      documentId,
      activeLayerId: doc?.activeLayers?.[0]?.id ?? null,
      selection: null,
      activeChannel: 'composite'
    };
  }

  async restoreUi(state: UiState): Promise<void> {
    if (state.activeLayerId !== null) {
      await this.batch([{ _obj: 'select', _target: [{ _ref: 'layer', _id: state.activeLayerId }], makeVisible: false }]);
    }
    if (!state.selection) {
      await this.batch([{
        _obj: 'set',
        _target: [{ _ref: 'channel', _property: 'selection' }],
        to: { _enum: 'ordinal', _value: 'none' }
      }]);
      return;
    }
    const bounds = state.selection.bounds;
    await this.batch([{
      _obj: 'set',
      _target: [{ _ref: 'channel', _property: 'selection' }],
      to: {
        _obj: 'rectangle',
        top: { _unit: 'pixelsUnit', _value: bounds.top },
        left: { _unit: 'pixelsUnit', _value: bounds.left },
        bottom: { _unit: 'pixelsUnit', _value: bounds.top + bounds.height },
        right: { _unit: 'pixelsUnit', _value: bounds.left + bounds.width }
      }
    }]);
  }

  async undo(_documentId: number): Promise<void> {
    await this.batch([{ _obj: 'select', _target: [{ _ref: 'historyState', _enum: 'ordinal', _value: 'previous' }] }]);
  }

  async historyTopIs(_documentId: number, name: string): Promise<boolean> {
    const states = listOf(this.ps.app.activeDocument?.historyStates);
    return states.at(-1)?.name === name;
  }

  private async batch(commands: unknown[]): Promise<Array<Record<string, unknown>>> {
    if (!this.ps.action?.batchPlay) throw new AppError(500, 'HOST_BUSY', '当前宿主没有 batchPlay。');
    return this.ps.action.batchPlay(commands, { synchronousExecution: true });
  }
}
