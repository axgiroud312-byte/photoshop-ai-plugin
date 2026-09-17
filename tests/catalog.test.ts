import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { baselineCatalog } from '../packages/catalog/src/baseline.js';
import { adaptCatalog } from '../packages/catalog/src/adapt.js';
import { diffCatalog, withMock } from '../packages/catalog/src/refresh.js';
import { loadBaselineInput } from '../packages/catalog/src/baseline.js';

test('cangyuan catalog baseline and diffs', () => {
  const snapshot = baselineCatalog(false);
  const publicModels = snapshot.models.filter(m => m.publicListed);
  const docsOnly = snapshot.models.filter(m => m.catalog === 'documentation-only');
  assert.equal(publicModels.length, 26);
  assert.equal(docsOnly.length, 2);
  assert.equal(snapshot.models.length, 28);
  assert.equal(snapshot.releaseBlocked, false);
  const baselineHash = createHash('sha256').update(readFileSync('packages/catalog/data/baseline-input.json')).digest('hex');
  assert.equal(baselineHash, '4e01d5a8ee1ed38ac35f8ea696959a29fe00657283d8822e47636b2d17696051');
  assert.ok(docsOnly.some(m => m.id === 'flux-pro-2'));
  assert.ok(docsOnly.some(m => m.id === 'nano-banana-pro'));
  assert.equal(snapshot.models.some(m => m.id.startsWith('midjourney')), false);

  const lite = snapshot.models.find(m => m.id === 'grok-imagine-image-lite')!;
  assert.equal(lite.declaredEdit, false);
  assert.equal(lite.editReady, false);
  assert.ok(!lite.fields.includes('images'));

  const grok2 = snapshot.models.find(m => m.id === 'grok-imagine-image-2.0')!;
  assert.equal(grok2.declaredEdit, false);
  assert.ok(grok2.warnings.some(w => w.includes('待验证')));

  const banana4k = snapshot.models.find(m => m.id === 'nano-banana2-4k')!;
  assert.equal(banana4k.maxReferenceImages, 9);

  const gpt = snapshot.models.find(m => m.id === 'gpt-image-2')!;
  assert.ok(!gpt.fields.includes('background'));
  assert.ok(!gpt.fields.includes('mask'));

  const gemini = snapshot.models.find(m => m.id === 'gemini-3-pro-image-preview')!;
  assert.deepEqual(gemini.qualities, ['1k', '2k', '4k']);
  const gpt1k = snapshot.models.find(m => m.id === 'gpt-image-2-1k')!;
  assert.ok(gpt1k.qualities.includes('medium'));
  assert.ok(!gemini.qualities.includes('medium'));

  const file = loadBaselineInput();
  const mjAdapter = adaptCatalog({
    collectedAt: snapshot.collectedAt, collectedAtLocal: snapshot.collectedAtLocal, source: 'baseline-cache',
    pricing: [{ model_name: 'midjourney-1k', image_ui_params: { params: { count: { max: 1 } } } }],
    docs: { 'midjourney-1k': { params: [{ name: 'prompt' }, { name: 'speed' }, { name: 'images' }, { name: 'reference' }], endpoints: [{ method: 'POST', path: '/v1/images/generations' }, { method: 'POST', path: '/v1/images/edits' }] } },
    keyVisibleIds: null, sourceUploadVerified: false
  }).models.find(m => m.id === 'midjourney-1k')!;
  assert.equal(mjAdapter.nativeCandidates, 4);
  assert.equal(mjAdapter.nativeCandidateShape, 'unknown');
  assert.equal(mjAdapter.defaults.speed, 'relax');
  const previousWithMj = adaptCatalog({
    collectedAt: snapshot.collectedAt, collectedAtLocal: snapshot.collectedAtLocal, source: 'baseline-cache',
    pricing: [...file.pricing, { model_name: 'midjourney-1k', image_ui_params: { params: { count: { max: 1 } } } }],
    docs: { ...file.docs, 'midjourney-1k': { params: [{ name: 'prompt' }], endpoints: [{ method: 'POST', path: '/v1/images/generations' }] } },
    keyVisibleIds: null, sourceUploadVerified: false
  });
  assert.ok(diffCatalog(previousWithMj, snapshot).removed.includes('midjourney-1k'));

  snapshot.models.forEach(model => {
    assert.equal(model.liveVerified, false);
    assert.equal(model.editReady, false);
    assert.equal(model.costFenUnknown, true);
  });
  const mutatedDocs = { ...file.docs, 'brand-new-image': { params: [{ name: 'prompt' }], endpoints: [{ method: 'POST', path: '/v1/images/generations' }], intro: 'new' } };
  const mutatedPricing = [...file.pricing, { model_name: 'brand-new-image', image_ui_params: { params: { count: { max: 1 } } } }];
  const next = adaptCatalog({
    collectedAt: '2026-09-18T00:00:00.000Z', collectedAtLocal: 'later', source: 'live-refresh',
    pricing: mutatedPricing, docs: mutatedDocs, keyVisibleIds: null, sourceUploadVerified: false
  });
  const diff = diffCatalog(snapshot, next);
  assert.ok(diff.added.includes('brand-new-image'));
  assert.equal(next.releaseBlocked, true);

  const removedPricing = file.pricing.filter(row => row.model_name !== 'grok-imagine-image-lite');
  const withoutLite = { ...file.docs };
  delete withoutLite['grok-imagine-image-lite'];
  const afterRemove = adaptCatalog({
    collectedAt: snapshot.collectedAt, collectedAtLocal: snapshot.collectedAtLocal, source: 'live-refresh',
    pricing: removedPricing, docs: withoutLite, keyVisibleIds: null, sourceUploadVerified: false
  });
  assert.ok(diffCatalog(snapshot, afterRemove).removed.includes('grok-imagine-image-lite'));

  const mock = withMock(snapshot, 'mock');
  assert.ok(mock.models.some(m => m.id === 'mock-edit' && m.mockVerified));
});
