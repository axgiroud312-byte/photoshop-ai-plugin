import { makeFixture, rgbaLength } from '../../contracts/src/pixels.js';
import type { RawImage, Rect } from '../../contracts/src/application.js';
import type { HostAdapter, HostDocument, HostLayer, ModalContext, PixelObject, UiState } from './types.js';

let nextId = 100;

export function createMockDocument(overrides: Partial<HostDocument> = {}): HostDocument {
  const fixture = makeFixture();
  const layer: HostLayer = {
    id: 11, name: '几何印花', kind: 'pixel', parentId: 10, indexInParent: 0,
    visible: true, locked: false, opacity: 100, fillOpacity: 100, blendMode: 'normal',
    bounds: { left: 17, top: 23, width: fixture.width, height: fixture.height },
    hasMask: false, hasEffects: false, clipped: false, isBackground: false, empty: false
  };
  const group: HostLayer = {
    id: 10, name: '包装', kind: 'group', parentId: null, indexInParent: 0,
    visible: true, locked: false, opacity: 100, fillOpacity: 100, blendMode: 'passThrough',
    bounds: layer.bounds, hasMask: false, hasEffects: false, clipped: false, isBackground: false, empty: false
  };
  const under: HostLayer = {
    id: 9, name: '底色', kind: 'pixel', parentId: null, indexInParent: 0,
    visible: true, locked: false, opacity: 100, fillOpacity: 100, blendMode: 'normal',
    bounds: { left: 0, top: 0, width: 400, height: 300 },
    hasMask: false, hasEffects: false, clipped: false, isBackground: false, empty: false
  };
  return {
    id: 1, name: '包装设计.psd', openToken: 'open-1', width: 400, height: 300,
    mode: 'RGB', bitsPerChannel: 8, profile: 'sRGB IEC61966-2.1', pixelAspect: 1,
    layers: [under, group, layer],
    selection: null, activeChannel: 'composite', activeLayerId: 11,
    quickMask: false, historyTopName: null, historyLength: 1,
    ...overrides
  };
}

export class MockHost implements HostAdapter {
  sessionId = 'ps-session-1';
  hostVersion = '27.8.0-mock';
  documents: HostDocument[] = [createMockDocument()];
  pixels = new Map<string, Uint8Array>();
  disposed = 0;
  failWrite: string | null = null;
  history: string[] = [];

  constructor() {
    const fixture = makeFixture();
    this.pixels.set('1:11', fixture.pixels.slice());
    this.pixels.set('1:9', new Uint8Array(rgbaLength(400, 300)).fill(255));
  }

  async listDocuments(): Promise<HostDocument[]> { return this.documents.map(cloneDoc); }
  async getDocument(id: number): Promise<HostDocument | null> {
    const doc = this.documents.find(item => item.id === id);
    return doc ? cloneDoc(doc) : null;
  }

  async getPixels(documentId: number, layerId: number, requested: Rect): Promise<PixelObject> {
    const layer = this.documents.find(d => d.id === documentId)?.layers.find(l => l.id === layerId);
    if (!layer) throw new Error('missing layer');
    const stored = this.pixels.get(documentId + ':' + layerId) ?? new Uint8Array(rgbaLength(layer.bounds.width, layer.bounds.height));
    const pixels = stored.slice();
    let disposed = false;
    void requested;
    return {
      bounds: { ...layer.bounds }, level: 0, pixels,
      get disposed() { return disposed; },
      dispose: () => { if (!disposed) { disposed = true; this.disposed++; pixels.fill(0); } }
    };
  }

  async executeAsModal<T>(commandName: string, fn: (ctx: ModalContext) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.documents);
    const pixels = new Map(this.pixels);
    let suspended = false;
    const ctx: ModalContext = {
      isCancelled: false,
      suspendHistory: async name => { suspended = true; this.history.push(name); },
      resumeHistory: async commit => {
        if (!suspended) return;
        suspended = false;
        if (!commit) {
          this.documents = snapshot;
          this.pixels = pixels;
          this.history.pop();
        } else {
          const doc = this.documents[0];
          if (doc) {
            doc.historyTopName = this.history[this.history.length - 1] ?? null;
            doc.historyLength += 1;
          }
        }
      }
    };
    if (this.failWrite) ctx.failAt = this.failWrite;
    try {
      return await fn(ctx);
    } catch (error) {
      if (suspended) {
        this.documents = snapshot;
        this.pixels = pixels;
        this.history.pop();
      }
      throw error;
    }
  }

  async createPixelLayer(documentId: number, parentId: number | null, name: string, belowLayerId: number | null, hidden: boolean): Promise<number> {
    const doc = this.require(documentId);
    const id = ++nextId;
    const siblings = doc.layers.filter(l => l.parentId === parentId);
    const below = belowLayerId === null ? siblings.length : siblings.find(l => l.id === belowLayerId)?.indexInParent ?? siblings.length;
    const layer: HostLayer = {
      id, name, kind: 'pixel', parentId, indexInParent: below + 1,
      visible: !hidden, locked: false, opacity: 100, fillOpacity: 100, blendMode: 'normal',
      bounds: { left: 0, top: 0, width: 1, height: 1 },
      hasMask: false, hasEffects: false, clipped: false, isBackground: false, empty: true
    };
    for (const item of doc.layers) {
      if (item.parentId === parentId && item.indexInParent >= layer.indexInParent) item.indexInParent++;
    }
    doc.layers.push(layer);
    this.pixels.set(documentId + ':' + id, new Uint8Array(4));
    return id;
  }

  async writePixels(documentId: number, layerId: number, image: RawImage, at: Rect): Promise<void> {
    const doc = this.require(documentId);
    const layer = doc.layers.find(l => l.id === layerId);
    if (!layer) throw new Error('missing layer');
    layer.bounds = { ...at, width: image.width, height: image.height };
    layer.empty = false;
    this.pixels.set(documentId + ':' + layerId, image.pixels.slice());
  }

  async setVisibility(documentId: number, layerId: number, visible: boolean): Promise<void> {
    const layer = this.require(documentId).layers.find(l => l.id === layerId);
    if (layer) layer.visible = visible;
  }

  async moveLayerAbove(documentId: number, layerId: number, targetId: number): Promise<void> {
    const doc = this.require(documentId);
    const layer = doc.layers.find(l => l.id === layerId);
    const target = doc.layers.find(l => l.id === targetId);
    if (!layer || !target) throw new Error('missing layer');
    layer.parentId = target.parentId;
    layer.indexInParent = target.indexInParent + 1;
  }

  async captureUi(documentId: number): Promise<UiState> {
    const doc = this.require(documentId);
    return { documentId, activeLayerId: doc.activeLayerId, selection: doc.selection, activeChannel: doc.activeChannel };
  }

  async restoreUi(state: UiState): Promise<void> {
    const doc = this.require(state.documentId);
    doc.activeLayerId = state.activeLayerId;
    doc.selection = state.selection;
    doc.activeChannel = state.activeChannel;
  }

  async undo(documentId: number): Promise<void> {
    void documentId;
    const name = this.history.pop();
    if (!name) return;
    const result = this.documents[0]?.layers.find(l => l.name.startsWith('AI ·'));
    if (result) {
      this.documents[0]!.layers = this.documents[0]!.layers.filter(l => l.id !== result.id);
      const source = this.documents[0]!.layers.find(l => l.id === 11);
      if (source) source.visible = true;
    }
    const doc = this.documents[0];
    if (doc) {
      doc.historyTopName = this.history[this.history.length - 1] ?? null;
      doc.historyLength = Math.max(1, doc.historyLength - 1);
    }
  }

  async historyTopIs(documentId: number, name: string): Promise<boolean> {
    return this.require(documentId).historyTopName === name;
  }

  mutateSourcePixels(): void {
    const pixels = this.pixels.get('1:11');
    if (pixels) pixels[0] = (pixels[0]! + 1) & 255;
  }

  private require(id: number): HostDocument {
    const doc = this.documents.find(item => item.id === id);
    if (!doc) throw new Error('missing document');
    return doc;
  }
}

function cloneDoc(doc: HostDocument): HostDocument {
  return structuredClone(doc);
}


