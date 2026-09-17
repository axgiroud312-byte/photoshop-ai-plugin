import type { Candidate, JobInfo, ModelInfo, ServiceConfig, SourceSnapshot, WorkMode } from '../../contracts/src/application.js';

export type UiPhase =
  | 'EMPTY' | 'DRAFT' | 'CAPTURING' | 'GENERATING' | 'RESULT_READY'
  | 'VALIDATING' | 'APPLYING' | 'APPLIED' | 'CONFLICT' | 'ERROR' | 'DISCONNECTED';

export interface DialogState {
  id: 'send' | 'replace' | 'paid-test' | 'unknown-retry' | 'discard-settings' | null;
  title: string;
  body: string;
}

export interface PanelState {
  evidence: 'mock' | 'browser-demo' | 'uxp';
  page: 'edit' | 'settings';
  mode: WorkMode;
  phase: UiPhase;
  prompt: string;
  modelId: string;
  modelQuery: string;
  models: ModelInfo[];
  options: Record<string, string | number | boolean>;
  config: ServiceConfig | null;
  connected: boolean;
  source: SourceSnapshot | null;
  currentSelectionName: string | null;
  currentDocumentName: string | null;
  currentDocumentId: number | null;
  eligibilityError: string | null;
  job: JobInfo | null;
  selectedCandidate: number;
  preview: 'source' | 'result';
  waitedMs: number;
  stage: string;
  tokenInput: string;
  apiKeyInput: string;
  providerDraft: 'mock' | 'cangyuan';
  dialog: DialogState;
  notice: string;
  appliedLayerName: string | null;
  undoAvailable: boolean;
  settingsDirty: boolean;
}

export const INITIAL_STATE: PanelState = {
  evidence: 'mock',
  page: 'edit',
  mode: 'layer',
  phase: 'EMPTY',
  prompt: '',
  modelId: 'mock-edit',
  modelQuery: '',
  models: [],
  options: {},
  config: null,
  connected: false,
  source: null,
  currentSelectionName: null,
  currentDocumentName: null,
  currentDocumentId: null,
  eligibilityError: null,
  job: null,
  selectedCandidate: 0,
  preview: 'result',
  waitedMs: 0,
  stage: '',
  tokenInput: '',
  apiKeyInput: '',
  providerDraft: 'mock',
  dialog: { id: null, title: '', body: '' },
  notice: '',
  appliedLayerName: null,
  undoAvailable: false,
  settingsDirty: false
};

export function activeModel(state: PanelState): ModelInfo | undefined {
  return state.models.find(model => model.id === state.modelId);
}

export function visibleModels(state: PanelState): ModelInfo[] {
  const query = state.modelQuery.trim().toLowerCase();
  return state.models.filter(model => {
    if (state.mode === 'layer' && !model.declaredEdit) return false;
    if (state.mode === 'text' && !model.declaredText) return false;
    if (!query) return true;
    return model.id.toLowerCase().includes(query) || model.family.toLowerCase().includes(query);
  });
}

export function groupedModels(state: PanelState): Array<{ family: string; models: ModelInfo[] }> {
  const groups: Array<{ family: string; models: ModelInfo[] }> = [];
  for (const model of visibleModels(state)) {
    const existing = groups.find(group => group.family === model.family);
    if (existing) existing.models.push(model);
    else groups.push({ family: model.family, models: [model] });
  }
  return groups;
}

export function defaultsFor(model: ModelInfo | undefined): Record<string, string | number | boolean> {
  return model ? { ...model.defaults } : {};
}

export function generateBlockedReason(state: PanelState): string | null {
  if (!state.connected) return '本地服务尚未连接。';
  if (!state.config) return '尚未读取服务配置。';
  if (state.phase === 'GENERATING' || state.phase === 'CAPTURING') return '已有生成任务。';
  if (!state.prompt.trim()) return '请先填写修改要求。';
  const model = activeModel(state);
  if (!model) return '请选择模型。';
  if (!model.adapted) return '该模型尚未适配，不能发送。';
  if (state.mode === 'layer') {
    if (!model.declaredEdit) return '当前模型仅支持文字生图。';
    if (state.config.provider === 'cangyuan' && !state.config.sourceUploadVerified) {
      return '本地图层尚未确认可安全发送，整层编辑仅在 Mock 下可用。';
    }
    if (!state.source) return state.eligibilityError ?? '请选择一个普通像素图层。';
  }
  if (state.mode === 'text') {
    if (!model.declaredText) return '当前模型不支持文字生图。';
    if (state.currentDocumentId === null && !state.source) {
      return state.eligibilityError ?? '请先打开一个 Photoshop 文档。';
    }
  }
  const n = typeof state.options.n === 'number' ? state.options.n : model.nMin;
  if (n < model.nMin || n > model.nMax) return '候选数量超出该模型允许范围。';
  if (typeof state.options.size === 'string' && model.sizes.length && !model.sizes.includes(state.options.size)) {
    return '当前尺寸不属于该模型白名单。';
  }
  if (typeof state.options.quality === 'string' && model.qualities.length && !model.qualities.includes(state.options.quality)) {
    return '当前质量不属于该模型白名单。';
  }
  if (typeof state.options.speed === 'string' && model.speeds.length && !model.speeds.includes(state.options.speed)) {
    return '当前速度不属于该模型白名单。';
  }
  return null;
}

export function canGenerate(state: PanelState): boolean {
  return generateBlockedReason(state) === null && (state.phase === 'DRAFT' || state.phase === 'EMPTY' || state.phase === 'ERROR');
}

export function verificationLabel(config: ServiceConfig | null): { level: 'format' | 'auth' | 'live' | 'none' | 'mock'; text: string } {
  if (!config) return { level: 'none', text: '尚未检查配置' };
  if (config.liveImageVerified && config.provider === 'mock') {
    return { level: 'mock', text: 'Mock 图像路径已验证，不是真实模型验收' };
  }
  if (config.liveImageVerified) return { level: 'live', text: '真实生图已验证' };
  if (config.authChecked) return { level: 'auth', text: '鉴权通过，尚未验证图像编辑' };
  if (config.formatChecked) return { level: 'format', text: '格式检查通过，尚未鉴权' };
  return { level: 'none', text: '尚未验证图像编辑' };
}

export function parseSessionDescriptor(text: string): { url: string; token: string } {
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error('会话文件不是有效 JSON。'); }
  if (!data || typeof data !== 'object') throw new Error('会话文件无效。');
  const record = data as { url?: unknown; token?: unknown };
  if (record.url !== 'http://127.0.0.1:47833') {
    throw new Error('会话地址必须是本机 127.0.0.1:47833。');
  }
  if (typeof record.token !== 'string' || record.token.length < 16) {
    throw new Error('会话 Token 无效。');
  }
  return { url: record.url, token: record.token };
}

function pickModel(models: ModelInfo[], current: string, mode: WorkMode): string {
  if (models.some(model => model.id === current && (mode === 'text' ? model.declaredText : model.declaredEdit))) {
    return current;
  }
  const first = models.find(model => mode === 'text' ? model.declaredText : model.declaredEdit);
  return first?.id ?? current;
}

export function reduce(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case 'connected': {
      const modelId = pickModel(event.models, state.modelId, state.mode);
      const model = event.models.find(item => item.id === modelId);
      return {
        ...state,
        connected: true,
        config: event.config,
        models: event.models,
        modelId,
        options: Object.keys(state.options).length ? state.options : defaultsFor(model),
        phase: state.phase === 'DISCONNECTED' || state.phase === 'EMPTY' ? 'DRAFT' : state.phase,
        notice: ''
      };
    }
    case 'disconnected':
      return { ...state, connected: false, phase: 'DISCONNECTED', notice: '本地服务连接已断开。' };
    case 'mode': {
      const modelId = pickModel(state.models, state.modelId, event.mode);
      return { ...state, mode: event.mode, modelId, options: defaultsFor(state.models.find(item => item.id === modelId)) };
    }
    case 'prompt':
      return { ...state, prompt: event.prompt.slice(0, 4000), phase: state.phase === 'EMPTY' ? 'DRAFT' : state.phase };
    case 'model':
      return { ...state, modelId: event.id, options: defaultsFor(state.models.find(item => item.id === event.id)) };
    case 'search':
      return { ...state, modelQuery: event.query };
    case 'option':
      return { ...state, options: { ...state.options, [event.name]: event.value } };
    case 'source':
      return {
        ...state,
        source: event.source,
        eligibilityError: event.error,
        currentSelectionName: event.selectionName,
        currentDocumentName: event.documentName,
        currentDocumentId: event.documentId ?? event.source?.documentId ?? state.currentDocumentId,
        phase: event.source || event.documentId ? 'DRAFT' : state.phase
      };
    case 'generating':
      return { ...state, phase: 'GENERATING', job: event.job, waitedMs: 0, stage: event.job.stage, dialog: { id: null, title: '', body: '' } };
    case 'tick':
      return { ...state, waitedMs: event.waitedMs, stage: event.stage, job: event.job ?? state.job };
    case 'result':
      return { ...state, phase: 'RESULT_READY', job: event.job, selectedCandidate: 0, preview: 'result' };
    case 'select':
      return { ...state, selectedCandidate: event.index };
    case 'preview':
      return { ...state, preview: event.which };
    case 'applying':
      return { ...state, phase: 'APPLYING' };
    case 'applied':
      return { ...state, phase: 'APPLIED', appliedLayerName: event.name, undoAvailable: true };
    case 'conflict':
      return { ...state, phase: 'CONFLICT', notice: event.message, undoAvailable: false };
    case 'error':
      return { ...state, phase: 'ERROR', notice: event.message };
    case 'page':
      return { ...state, page: event.page };
    case 'dialog':
      return { ...state, dialog: event.dialog };
    case 'token':
      return { ...state, tokenInput: event.value, settingsDirty: true };
    case 'key':
      return { ...state, apiKeyInput: event.value, settingsDirty: true };
    case 'provider':
      return { ...state, providerDraft: event.provider, settingsDirty: true };
    case 'undo-disabled':
      return { ...state, undoAvailable: false, notice: '后面已有其他编辑，请在 Photoshop 历史面板处理。' };
    case 'notice':
      return { ...state, notice: event.message };
    default:
      return state;
  }
}

export type PanelEvent =
  | { type: 'connected'; config: ServiceConfig; models: ModelInfo[] }
  | { type: 'disconnected' }
  | { type: 'mode'; mode: WorkMode }
  | { type: 'prompt'; prompt: string }
  | { type: 'model'; id: string }
  | { type: 'search'; query: string }
  | { type: 'option'; name: string; value: string | number | boolean }
  | { type: 'source'; source: SourceSnapshot | null; error: string | null; selectionName: string | null; documentName: string | null; documentId?: number | null }
  | { type: 'generating'; job: JobInfo }
  | { type: 'tick'; waitedMs: number; stage: string; job?: JobInfo }
  | { type: 'result'; job: JobInfo }
  | { type: 'select'; index: number }
  | { type: 'preview'; which: 'source' | 'result' }
  | { type: 'applying' }
  | { type: 'applied'; name: string }
  | { type: 'conflict'; message: string }
  | { type: 'error'; message: string }
  | { type: 'page'; page: 'edit' | 'settings' }
  | { type: 'dialog'; dialog: DialogState }
  | { type: 'token'; value: string }
  | { type: 'key'; value: string }
  | { type: 'provider'; provider: 'mock' | 'cangyuan' }
  | { type: 'undo-disabled' }
  | { type: 'notice'; message: string };

export function selectedCandidate(state: PanelState): Candidate | undefined {
  return state.job?.candidates[state.selectedCandidate];
}

export function jobOptions(state: PanelState): Record<string, string | number | boolean> {
  const model = activeModel(state);
  const out: Record<string, string | number | boolean> = {};
  if (!model) return out;
  for (const [key, value] of Object.entries(state.options)) {
    if (model.fields.includes(key) || key === 'mockMode' || key === 'alphaPolicy') out[key] = value;
  }
  return out;
}
