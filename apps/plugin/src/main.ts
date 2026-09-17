import {
  INITIAL_STATE, activeModel, canGenerate, generateBlockedReason, groupedModels, jobOptions,
  parseSessionDescriptor, reduce, verificationLabel, type PanelState
} from '../../../packages/panel-store/src/store.js';
import { captureSource } from '../../../packages/host/src/snapshot.js';
import { applyCandidate, canUseDedicatedUndo } from '../../../packages/host/src/apply.js';
import { COLOR_PROFILE } from '../../../packages/contracts/src/pixels.js';
import { BridgeClient } from './bridge-client.js';
import { createHost } from './photoshop-host.js';

const demo = typeof document !== 'undefined' && document.documentElement.dataset.demo === 'true';
let state: PanelState = { ...INITIAL_STATE, evidence: demo ? 'browser-demo' : 'uxp' };
let client: BridgeClient | null = null;
let hostPromise = createHost(demo).catch((error: unknown) => {
  dispatch({ type: 'notice', message: error instanceof Error ? error.message : '无法连接 Photoshop 宿主。' });
  throw error;
});
let lastPixels: Uint8Array | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const root = document.getElementById('app')!;

function dispatch(event: Parameters<typeof reduce>[1]): void {
  state = reduce(state, event);
  render();
}

function render(): void {
  const model = activeModel(state);
  const blocked = generateBlockedReason(state);
  const verify = verificationLabel(state.config);
  const jobLocked = state.phase === 'GENERATING' || state.phase === 'CAPTURING' || state.phase === 'APPLYING';
  root.innerHTML = `
    ${demo ? '<div class="demo-banner">DEMO / 模拟宿主 — 浏览器效果不能作为 UXP 或 Photoshop 验收证据</div>' : ''}
    <header class="top">
      <div>
        <h1>AI 图层编辑 <span class="muted">v0.1</span></h1>
        <div class="muted">${state.mode === 'layer' ? '用文字描述，修改选中的图层' : '用文字生成新图像，应用到打开的文档'}</div>
      </div>
      <button type="button" data-act="settings" aria-label="设置">⚙</button>
    </header>
    <main class="scroll">
      ${state.page === 'settings' ? settingsPage(verify) : editPage(model, blocked, verify, jobLocked)}
    </main>
    <footer class="bottom">${footer(blocked, jobLocked)}</footer>
    ${state.dialog.id ? dialogHtml() : ''}
  `;
  root.querySelectorAll('[data-act]').forEach(node => {
    node.addEventListener('click', () => void onAction((node as HTMLElement).dataset.act!, node as HTMLElement));
  });
  root.querySelector('textarea')?.addEventListener('input', e => dispatch({ type: 'prompt', prompt: (e.target as HTMLTextAreaElement).value }));
  root.querySelector('[data-model]')?.addEventListener('change', e => dispatch({ type: 'model', id: (e.target as HTMLSelectElement).value }));
  root.querySelector('[data-search]')?.addEventListener('input', e => dispatch({ type: 'search', query: (e.target as HTMLInputElement).value }));
  root.querySelectorAll('[data-option]').forEach(node => {
    node.addEventListener('change', e => {
      const name = (node as HTMLElement).dataset.option!;
      const raw = (e.target as HTMLSelectElement | HTMLInputElement).value;
      dispatch({ type: 'option', name, value: name === 'n' ? Number(raw) : raw });
    });
  });
  root.querySelector('[data-token]')?.addEventListener('input', e => dispatch({ type: 'token', value: (e.target as HTMLInputElement).value }));
  root.querySelector('[data-key]')?.addEventListener('input', e => dispatch({ type: 'key', value: (e.target as HTMLInputElement).value }));
  root.querySelector('[data-provider]')?.addEventListener('change', e => dispatch({ type: 'provider', provider: (e.target as HTMLSelectElement).value as 'mock' | 'cangyuan' }));
}

function editPage(model: ReturnType<typeof activeModel>, blocked: string | null, verify: ReturnType<typeof verificationLabel>, jobLocked: boolean): string {
  const source = state.source;
  return `
    <div class="seg row">
      <button type="button" data-act="mode-layer" aria-pressed="${state.mode === 'layer'}">整层修改</button>
      <button type="button" disabled title="v0.2">选区 v0.2</button>
      <button type="button" disabled title="v0.3">蒙版 v0.3</button>
    </div>
    <div class="seg row" style="margin-top:8px">
      <button type="button" data-act="mode-text" aria-pressed="${state.mode === 'text'}">文字生图</button>
    </div>
    <section class="card">
      <div class="row"><strong>编辑目标</strong><button type="button" data-act="refresh" ${jobLocked ? 'disabled' : ''}>刷新</button></div>
      <div class="ellipsis">${state.mode === 'layer'
        ? escapeHtml(source ? source.sourceName : (state.eligibilityError ?? '尚未选择图层'))
        : escapeHtml(state.currentDocumentName ?? '尚未锁定文档')}</div>
      <div class="muted">${state.mode === 'layer'
        ? (source ? escapeHtml(source.documentName) + ' · ' + source.sourceRect.width + ' × ' + source.sourceRect.height + ' px' : (state.currentDocumentName ?? '没有打开的文档'))
        : (state.currentDocumentId !== null ? '已锁定打开的文档，不读取图层像素。' : '没有打开的文档')}</div>
      <div class="muted">${state.mode === 'layer' ? '仅发送此图层，不发送其他图层。' : '不读取源图层；结果将等比适配画布并居中。'}</div>
      ${state.job && state.currentSelectionName && source && state.currentSelectionName !== source.sourceName
        ? `<div class="warn">当前 PS 选择已变化，本任务仍编辑「${escapeHtml(source.sourceName)}」。</div>` : ''}
    </section>
    <label>你想怎么修改？
      <textarea ${jobLocked ? 'readonly' : ''}>${escapeHtml(state.prompt)}</textarea>
    </label>
    <section class="card">
      <div class="row"><strong>模型</strong></div>
      <input data-search type="search" placeholder="搜索模型或家族" value="${escapeHtml(state.modelQuery)}" ${jobLocked ? 'disabled' : ''}>
      <select data-model ${jobLocked ? 'disabled' : ''}>${modelOptionsHtml()}</select>
      <div class="muted">${model ? (model.declaredEdit ? '声明支持参考图/编辑' : '仅文字生图') + (model.adapted ? '' : ' · 未适配') : ''}</div>
      <div class="${verify.level === 'live' ? 'ok' : 'warn'}">${escapeHtml(verify.text)}</div>
      ${model?.warnings.map(w => `<div class="warn">${escapeHtml(w)}</div>`).join('') ?? ''}
      ${paramFields(model, jobLocked)}
    </section>
    ${state.mode === 'layer' ? `<section class="card">透明度
      <div>保持原图透明轮廓${model?.outputAlphaVerified ? '' : '（使用模型透明度尚未实测，已禁用）'}</div>
      <div class="muted">新建结果层；原层保留但隐藏。</div>
    </section>` : ''}
    ${state.phase === 'GENERATING' ? `<section class="card"><div>◌ ${escapeHtml(state.stage || '正在生成候选')}</div><div>已等待 ${Math.round(state.waitedMs / 1000)} 秒</div><div class="muted">画布尚未修改。没有百分比进度。</div></section>` : ''}
    ${state.job?.candidates.length ? candidateHtml() : ''}
    ${state.notice ? `<div class="${state.phase === 'ERROR' || state.phase === 'CONFLICT' ? 'err' : 'muted'}">${escapeHtml(state.notice)}</div>` : ''}
    ${blocked && state.phase !== 'GENERATING' ? `<div class="muted">${escapeHtml(blocked)}</div>` : ''}
  `;
}

function modelOptionsHtml(): string {
  const groups = groupedModels(state);
  if (groups.length === 0) return '<option value="">没有匹配的模型</option>';
  return groups.map(group =>
    `<optgroup label="${escapeHtml(group.family)}">${group.models.map(model =>
      `<option value="${escapeHtml(model.id)}" ${model.id === state.modelId ? 'selected' : ''}>${escapeHtml(model.id)}${model.adapted ? '' : '（未适配）'}${model.liveVerified ? '' : ' · 待验证'}</option>`
    ).join('')}</optgroup>`
  ).join('');
}

function paramFields(model: ReturnType<typeof activeModel>, jobLocked: boolean): string {
  if (!model) return '';
  const parts: string[] = [];
  const select = (name: string, label: string, values: Array<string | number>) => {
    const current = String(state.options[name] ?? model.defaults[name] ?? values[0] ?? '');
    return `<label>${escapeHtml(label)}
      <select data-option="${escapeHtml(name)}" ${jobLocked ? 'disabled' : ''}>${values.map(value =>
        `<option value="${escapeHtml(String(value))}" ${String(value) === current ? 'selected' : ''}>${escapeHtml(String(value))}</option>`
      ).join('')}</select></label>`;
  };
  if (model.sizes.length) parts.push(select('size', '尺寸', model.sizes));
  if (model.qualities.length) parts.push(select('quality', '质量', model.qualities));
  if (model.speeds.length) parts.push(select('speed', '速度', model.speeds));
  if (model.outputFormats.length) parts.push(select('output_format', '输出格式', model.outputFormats));
  if (model.nMax > model.nMin) {
    const values: number[] = [];
    for (let n = model.nMin; n <= model.nMax; n++) values.push(n);
    parts.push(select('n', '候选数量', values));
  }
  return parts.join('');
}

function candidateHtml(): string {
  const job = state.job!;
  const candidate = job.candidates[state.selectedCandidate];
  const src = candidate && client ? client.previewUrl(state.preview === 'source' && job.mode === 'layer' ? (job as { sourcePreview?: string }).sourcePreview ?? candidate.previewAssetId : candidate.previewAssetId) : '';
  return `<section class="card">
    <div class="row">候选预览
      <button type="button" data-act="prev-source" aria-pressed="${state.preview === 'source'}">原图</button>
      <button type="button" data-act="prev-result" aria-pressed="${state.preview === 'result'}">结果</button>
    </div>
    <div class="preview">${src ? `<img alt="预览" src="${src}">` : '无预览'}</div>
    <div class="muted">回填：${candidate?.width ?? '—'} × ${candidate?.height ?? '—'} px · ${escapeHtml(job.model)}</div>
    <div class="row">${job.candidates.map((item, index) =>
      `<button type="button" data-act="pick" data-i="${index}" aria-pressed="${index === state.selectedCandidate}">${escapeHtml(item.label)}</button>`).join('')}
    </div>
    <div class="row">
      <button type="button" data-act="export">导出 PNG</button>
      <button type="button" data-act="regen">重新生成</button>
    </div>
  </section>`;
}

function settingsPage(verify: ReturnType<typeof verificationLabel>): string {
  return `
    <button type="button" data-act="back">‹ 返回</button>
    <h2>模型设置</h2>
    <section class="card">
      <div>本地服务</div>
      <div class="muted">地址固定 127.0.0.1:47833</div>
      <button type="button" data-act="pick-session">选择本次会话文件</button>
      <label>或手动粘贴 Token <input data-token type="password" autocomplete="off" value="${escapeHtml(state.tokenInput)}"></label>
      <button type="button" data-act="connect">连接本地服务</button>
    </section>
    <section class="card">
      <label>协议
        <select data-provider>
          <option value="mock" ${state.providerDraft === 'mock' ? 'selected' : ''}>Mock（开发）</option>
          <option value="cangyuan" ${state.providerDraft === 'cangyuan' ? 'selected' : ''}>Cangyuan 图像</option>
        </select>
      </label>
      <label>API Key <input data-key type="password" autocomplete="off" placeholder="${state.config?.hasApiKey ? '已设置' : '仅保存在本地服务内存'}"></label>
      <div class="muted">密钥不会回读原文，也不会写入日志或 Git。</div>
      <div class="row">
        <button type="button" data-act="check">检查配置</button>
        <button type="button" data-act="test-edit">发送测试图·可能计费</button>
      </div>
      <div class="${verify.level === 'live' ? 'ok' : 'warn'}">${escapeHtml(verify.text)}</div>
    </section>
  `;
}

function footer(blocked: string | null, jobLocked: boolean): string {
  if (state.page === 'settings') return `<button class="primary" type="button" data-act="save">保存并返回</button>`;
  if (state.phase === 'GENERATING') return `<button class="primary" type="button" data-act="cancel">取消</button><div class="muted">取消不保证上游停止处理或计费。</div>`;
  if (state.phase === 'RESULT_READY' || state.phase === 'CONFLICT' || (state.phase === 'ERROR' && state.job?.candidates.length)) {
    const disabled = state.phase === 'CONFLICT' || state.phase === 'APPLYING';
    return `<button class="primary" type="button" data-act="apply" ${disabled ? 'disabled' : ''}>应用到画布</button>
      <div class="muted">应用前再次检查目标；可一次撤销。</div>`;
  }
  if (state.phase === 'APPLIED') {
    return `<button class="primary" type="button" data-act="undo" ${state.undoAvailable ? '' : 'disabled'}>撤销本次应用</button>
      <button type="button" data-act="refresh">读取当前选择，开始下一次编辑</button>`;
  }
  return `<button class="primary" type="button" data-act="generate" ${canGenerate(state) && !jobLocked ? '' : 'disabled'}>${state.mode === 'text' ? '生成图像' : '生成修改'}</button>
    <div class="muted">${blocked ?? '先生成候选，应用前不会改动画布。'}</div>`;
}

function dialogHtml(): string {
  return `<div class="dialog"><div class="card">
    <h3>${escapeHtml(state.dialog.title)}</h3>
    <p>${escapeHtml(state.dialog.body)}</p>
    <div class="row">
      <button type="button" data-act="dialog-no">返回</button>
      <button class="primary" type="button" data-act="dialog-yes">确认</button>
    </div>
  </div></div>`;
}

async function onAction(act: string, node: HTMLElement): Promise<void> {
  if (act === 'settings') return dispatch({ type: 'page', page: 'settings' });
  if (act === 'back') return dispatch({ type: 'page', page: 'edit' });
  if (act === 'mode-layer') {
    dispatch({ type: 'mode', mode: 'layer' });
    return refreshTarget();
  }
  if (act === 'mode-text') {
    dispatch({ type: 'mode', mode: 'text' });
    return refreshTarget();
  }
  if (act === 'prev-source') return dispatch({ type: 'preview', which: 'source' });
  if (act === 'prev-result') return dispatch({ type: 'preview', which: 'result' });
  if (act === 'pick') return dispatch({ type: 'select', index: Number(node.dataset.i) });
  if (act === 'connect') return connect();
  if (act === 'pick-session') return pickSession();
  if (act === 'save') return saveSettings();
  if (act === 'check') return check();
  if (act === 'test-edit') return dispatch({ type: 'dialog', dialog: { id: 'paid-test', title: '发送图像编辑测试？', body: '使用内置测试素材验证此模型。服务商可能计费。这不是当前 PSD。' } });
  if (act === 'generate') return dispatch({ type: 'dialog', dialog: { id: 'send', title: '发送此图层给模型？', body: '将发送目标图层图像和修改要求至本地服务，再由所选提供方处理。不会发送其他图层或 PSD 文件。' } });
  if (act === 'regen') return dispatch({ type: 'dialog', dialog: { id: 'replace', title: '替换当前候选？', body: '当前候选尚未应用。重新生成会替换它，并发起新的模型请求。' } });
  if (act === 'dialog-no') return dispatch({ type: 'dialog', dialog: { id: null, title: '', body: '' } });
  if (act === 'dialog-yes') return confirmDialog();
  if (act === 'cancel' && state.job && client) {
    await client.cancel(state.job.id);
    dispatch({ type: 'error', message: '已停止本插件等待；上游可能仍计费。' });
    return;
  }
  if (act === 'refresh') return refreshTarget();
  if (act === 'apply') return apply();
  if (act === 'export') return exportPng();
  if (act === 'undo') return undo();
}

async function pickSession(): Promise<void> {
  try {
    const text = await readSessionFile();
    const session = parseSessionDescriptor(text);
    dispatch({ type: 'token', value: session.token });
    await connect();
  } catch (error) {
    dispatch({ type: 'notice', message: error instanceof Error ? error.message : '无法读取会话文件。' });
  }
}

async function readSessionFile(): Promise<string> {
  if (demo) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return reject(new Error('已取消选择。'));
        file.text().then(resolve, reject);
      });
      input.click();
    });
  }
  const uxp = require('uxp') as typeof import('uxp');
  const file = await uxp.storage.localFileSystem.getFileForOpening({ types: ['json'] });
  if (!file) throw new Error('已取消选择。');
  return file.read({ format: uxp.storage.formats.utf8 });
}

async function connect(): Promise<void> {
  const token = state.tokenInput.trim();
  if (!token) return dispatch({ type: 'notice', message: '请填写配对 Token。' });
  client = new BridgeClient('http://127.0.0.1:47833', token);
  try {
    await client.health();
    const config = await client.config();
    const models = await client.models();
    dispatch({ type: 'connected', config, models: models.models });
    dispatch({ type: 'page', page: 'edit' });
    startHealthPoll();
  } catch (error) {
    dispatch({ type: 'disconnected' });
    dispatch({ type: 'notice', message: error instanceof Error ? error.message : '连接失败' });
  }
}

function startHealthPoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { void pollHealth(); }, 3000);
}

async function pollHealth(): Promise<void> {
  if (!client) return;
  try {
    await client.health();
    if (!state.connected) {
      const config = await client.config();
      const models = await client.models();
      dispatch({ type: 'connected', config, models: models.models });
    }
  } catch {
    if (state.connected) dispatch({ type: 'disconnected' });
  }
}

async function saveSettings(): Promise<void> {
  if (!client) await connect();
  if (!client) return;
  const payload: { provider: 'mock' | 'cangyuan'; apiKey?: string } = { provider: state.providerDraft };
  if (state.apiKeyInput.trim()) payload.apiKey = state.apiKeyInput.trim();
  const config = await client.saveConfig(payload);
  const models = await client.models();
  dispatch({ type: 'connected', config, models: models.models });
  dispatch({ type: 'key', value: '' });
  dispatch({ type: 'page', page: 'edit' });
}

async function check(): Promise<void> {
  if (!client) return;
  const result = await client.check();
  dispatch({ type: 'connected', config: result.config, models: state.models });
  dispatch({ type: 'notice', message: result.message });
}

async function confirmDialog(): Promise<void> {
  const id = state.dialog.id;
  dispatch({ type: 'dialog', dialog: { id: null, title: '', body: '' } });
  if (id === 'send' || id === 'replace') return generate();
  if (id === 'paid-test' && client) {
    const result = await client.testEdit();
    dispatch({ type: 'notice', message: result.message });
  }
}

async function refreshTarget(): Promise<void> {
  dispatch({ type: 'notice', message: '' });
  let host;
  try { host = await hostPromise; }
  catch (error) {
    dispatch({ type: 'source', source: null, error: error instanceof Error ? error.message : '宿主不可用', selectionName: null, documentName: null, documentId: null });
    return;
  }
  const docs = await host.listDocuments();
  const doc = docs[0];
  if (!doc) {
    dispatch({ type: 'source', source: null, error: '请先打开一个 Photoshop 文档。', selectionName: null, documentName: null, documentId: null });
    return;
  }
  if (state.mode === 'text') {
    lastPixels = null;
    dispatch({ type: 'source', source: null, error: null, selectionName: null, documentName: doc.name, documentId: doc.id });
    return;
  }
  const selected = doc.activeLayerId ? [doc.activeLayerId] : [];
  try {
    const { selectedPixelLayer } = await import('../../../packages/host/src/eligibility.js');
    const layer = selectedPixelLayer(doc, selected);
    const captured = await captureSource(host, doc, layer);
    lastPixels = captured.pixels;
    dispatch({ type: 'source', source: captured.snapshot, error: null, selectionName: layer.name, documentName: doc.name, documentId: doc.id });
  } catch (error) {
    lastPixels = null;
    dispatch({ type: 'source', source: null, error: error instanceof Error ? error.message : '图层不可用', selectionName: null, documentName: doc.name, documentId: doc.id });
  }
}

async function generate(): Promise<void> {
  if (!client) return;
  try {
    let sourceAssetId: string | undefined;
    if (state.mode === 'layer') {
      if (!state.source || !lastPixels) return;
      const uploaded = await client.uploadRgba(state.source.sourceRect.width, state.source.sourceRect.height, lastPixels);
      sourceAssetId = uploaded.id;
    }
    const options = jobOptions(state);
    const n = typeof options.n === 'number' ? options.n : 1;
    const job = await client.createJob({
      clientRequestId: 'req_' + Date.now(),
      mode: state.mode,
      model: state.modelId,
      prompt: state.prompt,
      sourceAssetId,
      alphaPolicy: 'preserve-source',
      n,
      options
    });
    dispatch({ type: 'generating', job });
    const started = Date.now();
    while (true) {
      const latest = await client.job(job.id);
      dispatch({ type: 'tick', waitedMs: Date.now() - started, stage: latest.stage, job: latest });
      if (latest.status === 'completed') { dispatch({ type: 'result', job: latest }); return; }
      if (latest.status === 'failed' || latest.status === 'cancelled' || latest.status === 'unknown') {
        dispatch({ type: 'error', message: latest.error?.message ?? latest.status });
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (error) {
    dispatch({ type: 'error', message: error instanceof Error ? error.message : '生成失败' });
  }
}

async function apply(): Promise<void> {
  if (!client || !state.job) return;
  const candidate = state.job.candidates[state.selectedCandidate];
  if (!candidate) return;
  dispatch({ type: 'applying' });
  const raw = await client.raw(candidate.id);
  let host;
  try { host = await hostPromise; }
  catch (error) {
    dispatch({ type: 'error', message: error instanceof Error ? error.message : '宿主不可用' });
    return;
  }
  const documentId = state.mode === 'layer' ? state.source?.documentId : state.currentDocumentId;
  if (!documentId) {
    dispatch({ type: 'conflict', message: '没有锁定的目标文档。' });
    return;
  }
  try {
    const resultName = 'AI · ' + (state.source?.sourceName ?? '生图') + ' · 01';
    const request = {
      mode: state.mode,
      documentId,
      image: { width: raw.width, height: raw.height, channels: 4, componentSize: 8, colorProfile: COLOR_PROFILE, alphaMode: 'straight', pixels: raw.pixels },
      candidateId: candidate.id,
      resultName
    };
    await applyCandidate(host, state.source ? { ...request, snapshot: state.source } : request);
    dispatch({ type: 'applied', name: resultName });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'SOURCE_CHANGED' || code === 'TARGET_CLOSED') dispatch({ type: 'conflict', message: error instanceof Error ? error.message : '源状态冲突' });
    else dispatch({ type: 'error', message: error instanceof Error ? error.message : '应用失败' });
  }
}

async function exportPng(): Promise<void> {
  if (!client || !state.job) return;
  const candidate = state.job.candidates[state.selectedCandidate];
  if (!candidate) return;
  const bytes = await client.png(candidate.exportAssetId);
  if (demo) {
    const blob = new Blob([bytes], { type: 'image/png' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-export.png';
    a.click();
    return;
  }
  try {
    const uxp = require('uxp') as typeof import('uxp');
    const file = await uxp.storage.localFileSystem.getFileForSaving('ai-export.png', { types: ['png'] });
    if (file) await file.write(bytes);
  } catch {
    dispatch({ type: 'notice', message: '已取消保存。' });
  }
}

async function undo(): Promise<void> {
  const host = await hostPromise;
  const documentId = state.source?.documentId ?? state.currentDocumentId;
  const historyName = state.mode === 'text' ? 'AI 生图：应用结果' : 'AI 编辑：应用结果';
  const ok = documentId !== null ? await canUseDedicatedUndo(host, documentId, historyName) : false;
  if (!ok) return dispatch({ type: 'undo-disabled' });
  await host.undo(documentId!);
  dispatch({ type: 'notice', message: '已请求撤销本次应用。' });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

render();
if (demo) {
  void (async () => {
    try { await refreshTarget(); } catch { /* demo still renders */ }
  })();
}

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canGenerate(state)) {
    void onAction('generate', root);
  }
});
