import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockHost, createMockDocument } from '../packages/host/src/mock.js';
import { captureSource } from '../packages/host/src/snapshot.js';
import { applyCandidate, clearApplyMemory } from '../packages/host/src/apply.js';
import { selectedPixelLayer } from '../packages/host/src/eligibility.js';
import { makeFixture } from '../packages/contracts/src/pixels.js';
import type { RawImage } from '../packages/contracts/src/application.js';

function rawImage(width: number, height: number, pixels: Uint8Array): RawImage {
  return {
    width, height, channels: 4, componentSize: 8,
    colorProfile: 'sRGB IEC61966-2.1', alphaMode: 'straight', pixels
  };
}

test('mock host capture, apply, rollback and idempotency', async t => {
  t.after(() => clearApplyMemory());

  await t.test('non-zero bounds capture uses actual layer rectangle', async () => {
    const host = new MockHost();
    const doc = (await host.listDocuments())[0]!;
    const layer = selectedPixelLayer(doc, [11]);
    const captured = await captureSource(host, doc, layer);
    assert.equal(captured.snapshot.sourceRect.left, 17);
    assert.equal(captured.snapshot.sourceRect.top, 23);
    assert.equal(captured.pixels.byteLength, makeFixture().pixels.byteLength);
    assert.equal(host.disposed, 1);
  });

  await t.test('apply creates sibling above, hides source, one history step', async () => {
    const host = new MockHost();
    const doc = (await host.listDocuments())[0]!;
    const layer = selectedPixelLayer(doc, [11]);
    const captured = await captureSource(host, doc, layer);
    const image = rawImage(captured.snapshot.sourceRect.width, captured.snapshot.sourceRect.height, captured.pixels);
    const applied = await applyCandidate(host, {
      mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cand-1', resultName: 'AI · 几何印花 · 01'
    });
    const after = await host.getDocument(1);
    const result = after!.layers.find(l => l.id === applied.resultLayerId)!;
    const source = after!.layers.find(l => l.id === 11)!;
    assert.equal(result.parentId, source.parentId);
    assert.equal(result.visible, true);
    assert.equal(source.visible, false);
    assert.equal(after!.historyTopName, 'AI 编辑：应用结果');
    const again = await applyCandidate(host, {
      mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cand-1', resultName: 'AI · 几何印花 · 01'
    });
    assert.equal(again.resultLayerId, applied.resultLayerId);
  });

  await t.test('failure at create/write/visibility rolls back without hiding source', async () => {
    for (const stage of ['create', 'write', 'visibility']) {
      clearApplyMemory();
      const host = new MockHost();
      host.failWrite = stage;
      const doc = (await host.listDocuments())[0]!;
      const layer = selectedPixelLayer(doc, [11]);
      const captured = await captureSource(host, doc, layer);
      const image = rawImage(captured.snapshot.sourceRect.width, captured.snapshot.sourceRect.height, captured.pixels);
      await assert.rejects(() => applyCandidate(host, {
        mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cand-' + stage, resultName: 'AI · x'
      }));
      const after = await host.getDocument(1);
      assert.equal(after!.layers.find(l => l.id === 11)!.visible, true);
      assert.equal(after!.layers.some(l => l.name.startsWith('AI ·')), false);
    }
  });

  await t.test('source pixel change and closed document are conflicts', async () => {
    const host = new MockHost();
    const doc = (await host.listDocuments())[0]!;
    const layer = selectedPixelLayer(doc, [11]);
    const captured = await captureSource(host, doc, layer);
    host.mutateSourcePixels();
    const image = rawImage(captured.snapshot.sourceRect.width, captured.snapshot.sourceRect.height, captured.pixels);
    await assert.rejects(() => applyCandidate(host, {
      mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cand-changed', resultName: 'AI · x'
    }), /源图层像素已变化|SOURCE_CHANGED/);
    host.documents = [];
    await assert.rejects(() => applyCandidate(host, {
      mode: 'layer', snapshot: captured.snapshot, documentId: 1, image, candidateId: 'cand-closed', resultName: 'AI · x'
    }), /关闭|TARGET_CLOSED/);
  });

  await t.test('text apply does not change existing visibility', async () => {
    const host = new MockHost();
    const before = (await host.getDocument(1))!;
    const vis = new Map(before.layers.map(l => [l.id, l.visible]));
    const fixture = makeFixture(32, 24);
    await applyCandidate(host, {
      mode: 'text', documentId: 1,
      image: rawImage(32, 24, fixture.pixels),
      candidateId: 'text-1', resultName: 'AI · 生图 · 01'
    });
    const after = (await host.getDocument(1))!;
    for (const [id, visible] of vis) {
      assert.equal(after.layers.find(l => l.id === id)!.visible, visible);
    }
    assert.ok(after.layers.some(l => l.name.startsWith('AI · 生图')));
  });

  await t.test('failure at move rolls back without hiding source', async () => {
    clearApplyMemory();
    const host = new MockHost();
    host.failWrite = 'move';
    const doc = (await host.listDocuments())[0]!;
    const layer = selectedPixelLayer(doc, [11]);
    const captured = await captureSource(host, doc, layer);
    const image = rawImage(captured.snapshot.sourceRect.width, captured.snapshot.sourceRect.height, captured.pixels);
    await assert.rejects(() => applyCandidate(host, {
      mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cand-move', resultName: 'AI · x'
    }));
    const after = await host.getDocument(1);
    assert.equal(after!.layers.find(l => l.id === 11)!.visible, true);
    assert.equal(after!.layers.some(l => l.name.startsWith('AI ·')), false);
  });

  await t.test('reopened document with a new open token is rejected', async () => {
    const host = new MockHost();
    const doc = (await host.listDocuments())[0]!;
    const layer = selectedPixelLayer(doc, [11]);
    const captured = await captureSource(host, doc, layer);
    host.documents[0]!.openToken = 'open-reopened';
    const image = rawImage(captured.snapshot.sourceRect.width, captured.snapshot.sourceRect.height, captured.pixels);
    await assert.rejects(() => applyCandidate(host, {
      mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cand-reopen', resultName: 'AI · x'
    }), /关闭|TARGET_CLOSED/);
  });

  await t.test('20 capture/apply/undo cycles release pixel objects', async () => {
    const host = new MockHost();
    for (let i = 0; i < 20; i++) {
      clearApplyMemory();
      host.documents = [createMockDocument()];
      const fixture = makeFixture();
      host.pixels.set('1:11', fixture.pixels.slice());
      const doc = (await host.listDocuments())[0]!;
      const layer = selectedPixelLayer(doc, [11]);
      const captured = await captureSource(host, doc, layer);
      const image = rawImage(captured.snapshot.sourceRect.width, captured.snapshot.sourceRect.height, captured.pixels);
      await applyCandidate(host, {
        mode: 'layer', snapshot: captured.snapshot, documentId: doc.id, image, candidateId: 'cycle-' + i, resultName: 'AI · 几何印花 · 01'
      });
      await host.undo(1);
    }
    assert.ok(host.disposed >= 20);
  });
});
