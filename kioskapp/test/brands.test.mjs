import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPoseLabel,
  normalizeDetection,
  parseBrandReply,
  mergeDetections,
  renderBrandList,
  createBrandSense,
} from '../renderer/brands.js';

describe('formatPoseLabel', () => {
  test('shows event and dwell percent', () => {
    assert.equal(
      formatPoseLabel({ event: 'hands_over_eyes' }, { progress: () => 0.45 }, 'hands_over_eyes'),
      'hands_over_eyes  45%'
    );
  });

  test('stacks waiting text under the expected gesture', () => {
    assert.equal(formatPoseLabel({}, { progress: () => 0 }, 'hands_over_ears'), 'waiting: hands_over_ears');
  });

  test('falls back to no pose', () => {
    assert.equal(formatPoseLabel({}, { progress: () => 0 }, null), 'no pose');
  });
});

describe('parseBrandReply', () => {
  test('reads a JSON array, including prose around it', () => {
    const items = parseBrandReply('Sure.\n[{"name":"NVIDIA","kind":"brand"},{"name":"person","kind":"label"}]\n');
    assert.deepEqual(items, [
      { name: 'NVIDIA', kind: 'brand', score: null },
      { name: 'person', kind: 'label', score: null },
    ]);
  });

  test('reads a comma list when JSON is missing', () => {
    const items = parseBrandReply('NVIDIA, person, backpack');
    assert.equal(items.length, 3);
    assert.equal(items[0].name, 'NVIDIA');
    assert.equal(items[2].name, 'backpack');
  });

  test('empty and [] return no items', () => {
    assert.deepEqual(parseBrandReply(''), []);
    assert.deepEqual(parseBrandReply('[]'), []);
    assert.deepEqual(parseBrandReply(null), []);
  });
});

describe('normalizeDetection + mergeDetections', () => {
  test('drops nameless rows', () => {
    assert.equal(normalizeDetection({ kind: 'brand' }), null);
    assert.equal(normalizeDetection('  '), null);
  });

  test('dedupes by name, brands first, expires stale rows', () => {
    const now = 50_000;
    const merged = mergeDetections(
      [{ name: 'person', kind: 'label', at: now - 30_000 }, { name: 'VAST', kind: 'brand', at: now - 1000 }],
      [{ name: 'person', kind: 'label' }, { name: 'NVIDIA', kind: 'brand' }],
      now
    );
    assert.deepEqual(merged.map((item) => item.name), ['NVIDIA', 'VAST', 'person']);
  });
});

describe('renderBrandList', () => {
  test('empty state and escaped chips', () => {
    assert.match(renderBrandList([]), /no labels yet/);
    const html = renderBrandList([{ name: '<VAST>', kind: 'brand' }]);
    assert.match(html, /brand-chip--brand/);
    assert.match(html, /&lt;VAST&gt;/);
    assert.doesNotMatch(html, /<VAST>/);
  });
});

describe('createBrandSense', () => {
  test('push paints chips and onChange fires', () => {
    const listEl = { innerHTML: '' };
    let seen = null;
    const sense = createBrandSense({
      listEl,
      onChange: (items) => { seen = items; },
    });
    sense.push([{ name: 'NVIDIA', kind: 'brand' }]);
    assert.match(listEl.innerHTML, /NVIDIA/);
    assert.equal(seen[0].name, 'NVIDIA');
    assert.deepEqual(sense.snapshot(), [{ name: 'NVIDIA', kind: 'brand', score: null }]);
  });

  test('start polls describe and parses the reply', async () => {
    const listEl = { innerHTML: '' };
    const sense = createBrandSense({
      listEl,
      intervalMs: 10_000,
      snapshot: () => 'data:image/jpeg;base64,xx',
      describe: async () => ({ ok: true, text: '[{"name":"CoreWeave","kind":"brand"}]' }),
    });
    sense.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    sense.stop();
    assert.match(listEl.innerHTML, /CoreWeave/);
  });
});
