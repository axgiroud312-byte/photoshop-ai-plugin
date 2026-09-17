import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_STATE, canGenerate, generateBlockedReason, groupedModels, parseSessionDescriptor, reduce, verificationLabel } from '../packages/panel-store/src/store.js';
import type { ServiceConfig } from '../packages/contracts/src/application.js';

const config = (over: Partial<ServiceConfig> = {}): ServiceConfig => ({
  provider: 'mock', hasApiKey: false, liveEnabled: false, formatChecked: false, authChecked: false,
  liveImageVerified: false, spentFen: 0, reservedFen: 0, spentAndReservedFen: 0, budgetLimitFen: 3000,
  sourceUploadVerified: false, revision: 1, catalogCollectedAt: '2026-09-17T00:00:00.000Z', catalogSource: 'baseline-cache',
  ...over
});

test('panel store generation rules and verification copy', () => {
  let state = INITIAL_STATE;
  assert.equal(canGenerate(state), false);
  state = reduce(state, { type: 'connected', config: config(), models: [{
    id: 'mock-edit', family: 'Mock', catalog: 'public', fields: [], sizes: [], qualities: [], speeds: [], outputFormats: [],
    nMin: 1, nMax: 1, nativeCandidates: 1, nativeCandidateShape: 'separate-files', defaults: {}, declaredText: true,
    declaredEdit: true, editRoute: 'edits', generateRoute: 'generations', maxReferenceImages: 1, maskDeclared: false,
    adapted: true, mockVerified: true, liveVerified: false, editReady: true, outputAlphaVerified: true, keyVisible: true,
    publicListed: true, docsListed: true, costFenUnknown: false, publicPriceHint: 0, warnings: [], documentation: '', collectedAt: ''
  }] });
  state = reduce(state, { type: 'prompt', prompt: '改成暖橙' });
  assert.match(generateBlockedReason(state) ?? '', /图层/);
  state = reduce(state, { type: 'source', source: {
    photoshopSessionId: 's', documentOpenToken: 'o', documentId: 1, layerId: 2, parentLayerId: null,
    siblingAboveId: null, siblingBelowId: null, sourceRect: { left: 17, top: 23, width: 10, height: 10 },
    documentSize: { width: 100, height: 80 }, documentProfile: 'sRGB IEC61966-2.1', sourcePixelHash: 'a', structureHash: 'b',
    historyStateId: 1, sourceWasVisible: true, sourceName: '几何印花', documentName: '包装设计.psd', capturedAt: ''
  }, error: null, selectionName: '几何印花', documentName: '包装设计.psd' });
  assert.equal(canGenerate(state), true);

  assert.equal(verificationLabel(config({ formatChecked: true })).text.includes('格式检查通过'), true);
  assert.equal(verificationLabel(config({ formatChecked: true, authChecked: true })).text.includes('鉴权通过'), true);
  assert.equal(verificationLabel(config({ liveImageVerified: true })).text, 'Mock 图像路径已验证，不是真实模型验收');
  assert.equal(verificationLabel(config({ provider: 'cangyuan', liveImageVerified: true })).text, '真实生图已验证');
  assert.notEqual(verificationLabel(config({ formatChecked: true })).text, verificationLabel(config({ authChecked: true })).text);

  const disconnected = reduce(state, { type: 'disconnected' });
  assert.equal(disconnected.phase, 'DISCONNECTED');
  assert.equal(canGenerate(disconnected), false);

  const liveLayer = reduce(state, { type: 'connected', config: config({ provider: 'cangyuan' }), models: state.models });
  assert.match(generateBlockedReason(liveLayer) ?? '', /尚未确认可安全发送|本地图层/);

  const searched = reduce(state, { type: 'search', query: 'mock' });
  assert.equal(groupedModels(searched).some(group => group.family === 'Mock'), true);
  const session = parseSessionDescriptor(JSON.stringify({ url: 'http://127.0.0.1:47833', token: 'a'.repeat(32) }));
  assert.equal(session.url, 'http://127.0.0.1:47833');
  assert.throws(() => parseSessionDescriptor(JSON.stringify({ url: 'https://example.com', token: 'a'.repeat(32) })));
});
