import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBrandEntries, createBrandPanel } from '../renderer/brandPanel.js';

test('formatBrandEntries always shows Brands, and other groups only when filled', () => {
  assert.deepEqual(formatBrandEntries(null), []);
  assert.deepEqual(formatBrandEntries({ brands: [] }), [
    { label: 'Brands', text: 'none detected' },
  ]);
  const rows = formatBrandEntries({
    brands: ['NVIDIA'],
    clothingStyle: ['aloha shirt'],
    colors: [],
    accessories: ['lei'],
    labels: ['person', 'hands_over_eyes'],
  });
  assert.deepEqual(rows.map((r) => r.label), ['Brands', 'Style', 'Accessories', 'Labels']);
  assert.equal(rows[0].text, 'NVIDIA');
  assert.equal(rows[3].text, 'person, hands_over_eyes');
});

test('createBrandPanel stores and clears a report', () => {
  const panel = createBrandPanel();
  panel.setReport({ brands: ['VAST'] });
  assert.equal(panel.entries[0].text, 'VAST');
  panel.clear();
  assert.equal(panel.report, null);
  assert.deepEqual(panel.entries, []);
});
