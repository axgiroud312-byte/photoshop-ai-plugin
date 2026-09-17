import type { ApplyRecord, RawImage, Rect, SourceSnapshot, WorkMode } from '../../contracts/src/application.js';

export type LayerKind = 'pixel' | 'group' | 'smartObject' | 'adjustment' | 'text' | 'shape' | 'background' | 'other';

export interface HostLayer {
  id: number;
  name: string;
  kind: LayerKind;
  parentId: number | null;
  indexInParent: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: string;
  bounds: Rect;
  hasMask: boolean;
  hasEffects: boolean;
  clipped: boolean;
  isBackground: boolean;
  empty: boolean;
}

export interface HostDocument {
  id: number;
  name: string;
  openToken: string;
  width: number;
  height: number;
  mode: 'RGB' | 'CMYK' | 'Lab' | 'Grayscale' | 'other';
  bitsPerChannel: 8 | 16 | 32;
  profile: string;
  pixelAspect: number;
  layers: HostLayer[];
  selection: { bounds: Rect; pixels?: Uint8Array } | null;
  activeChannel: 'composite' | 'other';
  activeLayerId: number | null;
  quickMask: boolean;
  historyTopName: string | null;
  historyLength: number;
}

export interface PixelObject {
  bounds: Rect;
  level: number;
  pixels: Uint8Array;
  disposed: boolean;
  dispose(): void;
}

export interface UiState {
  documentId: number;
  activeLayerId: number | null;
  selection: HostDocument['selection'];
  activeChannel: HostDocument['activeChannel'];
}

export interface ModalContext {
  isCancelled: boolean;
  failAt?: string;
  suspendHistory(name: string): Promise<void>;
  resumeHistory(commit: boolean): Promise<void>;
}

export interface HostAdapter {
  sessionId: string;
  hostVersion: string;
  listDocuments(): Promise<HostDocument[]>;
  getDocument(id: number): Promise<HostDocument | null>;
  getPixels(documentId: number, layerId: number, requested: Rect): Promise<PixelObject>;
  executeAsModal<T>(commandName: string, fn: (ctx: ModalContext) => Promise<T>): Promise<T>;
  createPixelLayer(documentId: number, parentId: number | null, name: string, belowLayerId: number | null, hidden: boolean): Promise<number>;
  writePixels(documentId: number, layerId: number, image: RawImage, at: Rect): Promise<void>;
  setVisibility(documentId: number, layerId: number, visible: boolean): Promise<void>;
  moveLayerAbove(documentId: number, layerId: number, targetId: number): Promise<void>;
  captureUi(documentId: number): Promise<UiState>;
  restoreUi(state: UiState): Promise<void>;
  undo(documentId: number): Promise<void>;
  historyTopIs(documentId: number, name: string): Promise<boolean>;
}

export interface ApplyRequest {
  mode: WorkMode;
  snapshot?: SourceSnapshot;
  documentId: number;
  image: RawImage;
  candidateId: string;
  resultName: string;
}

export interface ApplyResult {
  record: ApplyRecord;
  resultLayerId: number;
}
