import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_REQUEST_BYTES,
  MEMORY_LIST_MAX,
  MEMORY_TEXT_MAX,
  PublicApiError,
  deriveMemoryTags,
  isPublicNonprofit,
  isTrustedEndorsement,
  parseJsonObject,
  rankMatch,
  toCauseSignal,
} from './public-api-core.mjs';

const cause = (id, overrides = {}) => ({
  PK: `CAUSE#${id}`,
  title: `Cause ${id}`,
  summary: 'A source-backed need.',
  nonprofit: 'Maui Helpers',
  nonprofitId: 'maui-helpers',
  causeTags: ['ocean'],
  urgency: 3,
  action: 'Help today.',
  url: `https://example.test/${id}`,
  source: 'test',
  fetchedAt: '2026-08-29T00:00:00.000Z',
  status: 'verified',
  verified: true,
  ...overrides,
});

const local = (id, overrides = {}) => ({
  PK: `LOCAL#${id}`,
  name: `Local ${id}`,
  town: 'Kahului',
  interests: ['ocean'],
  causes: ['ocean'],
  status: 'verified',
  verified: true,
  ...overrides,
});

test('parseJsonObject accepts an object and rejects malformed, array, and oversized bodies', () => {
  assert.deepEqual(parseJsonObject('{"ok":true}'), { ok: true });
  for (const raw of ['{', '[]', 'null']) {
    assert.throws(() => parseJsonObject(raw), (error) =>
      error instanceof PublicApiError && error.status === 400);
  }
  assert.throws(() => parseJsonObject(`{"x":"${'a'.repeat(MAX_REQUEST_BYTES)}"}`), (error) =>
    error instanceof PublicApiError && error.status === 413);
});

test('toCauseSignal returns the complete source-backed contract', () => {
  assert.deepEqual(toCauseSignal(cause('reef')), {
    id: 'reef',
    source: 'test',
    url: 'https://example.test/reef',
    title: 'Cause reef',
    causeTags: ['ocean'],
    urgency: 3,
    summary: 'A source-backed need.',
    fetchedAt: '2026-08-29T00:00:00.000Z',
    nonprofit: 'Maui Helpers',
    nonprofitId: 'maui-helpers',
    action: 'Help today.',
  });
});

test('toCauseSignal rejects missing or unsafe provenance', () => {
  for (const invalid of [
    { source: '' },
    { fetchedAt: '' },
    { fetchedAt: 'not-a-date' },
    { nonprofitId: '' },
    { nonprofitId: 'a'.repeat(121) },
    { urgency: '3' },
    { urgency: true },
    { url: 'http://example.test/reef' },
    { url: 'javascript:alert(1)' },
  ]) assert.equal(toCauseSignal(cause('unsafe', invalid)), null);
});

test('every demo cause satisfies the production CauseSignal contract', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/demo-data.json', import.meta.url), 'utf8'));
  for (const record of fixture.causes) {
    const signal = toCauseSignal({ PK: `CAUSE#${record.slug}`, ...record });
    assert.ok(signal, `invalid demo cause: ${record.slug}`);
    assert.equal(signal.nonprofitId.length > 0, true);
  }
});

test('the demo wheel retains ten valid experiences linked to known nonprofits', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/demo-data.json', import.meta.url), 'utf8'));
  const nonprofitIds = new Set(fixture.nonprofits.map((record) => record.slug));
  const slugs = new Set();
  assert.equal(fixture.experiences.length, 10);
  for (const experience of fixture.experiences) {
    assert.match(experience.slug, /^[a-z0-9-]+$/);
    assert.equal(slugs.has(experience.slug), false, `duplicate experience: ${experience.slug}`);
    slugs.add(experience.slug);
    assert.equal(nonprofitIds.has(experience.npoSlug), true, `unknown nonprofit: ${experience.npoSlug}`);
    assert.equal(typeof experience.title, 'string');
    assert.equal(typeof experience.description, 'string');
    for (const field of ['value', 'minDonation', 'perDay', 'perMonth']) {
      assert.equal(Number.isInteger(experience[field]) && experience[field] > 0, true, `${experience.slug}.${field}`);
    }
    assert.equal(experience.value >= experience.minDonation, true);
    assert.equal(experience.perMonth >= experience.perDay, true);
  }
});

test('unverified community records are never trusted', () => {
  assert.equal(isTrustedEndorsement({ PK: 'ENDORSE#random', verified: false, status: 'pending' }), false);
  assert.equal(isTrustedEndorsement({ PK: 'ENDORSE#seed-1', verified: true, status: 'verified' }), true);
  assert.equal(isPublicNonprofit({ PK: 'NPO#random', verified: false, status: 'pending' }), false);
  assert.equal(isPublicNonprofit({ PK: 'NPO#treecovery', name: 'Treecovery', verified: true, status: 'verified' }), true);
});

test('rankMatch ignores unverified locals and endorsements', () => {
  const match = rankMatch(
    { id: 'visitor-1', name: 'Kai', interests: ['ocean'] },
    {
      locals: [
        local('trusted'),
        local('untrusted', { verified: false, interests: ['ocean'], causes: ['ocean'] }),
      ],
      causes: [cause('reef')],
      endorsements: [
        { PK: 'ENDORSE#anonymous', nonprofit: 'Maui Helpers', verdict: 'causing_concern', verified: false, status: 'pending' },
      ],
    },
  );
  assert.equal(match.localId, 'trusted');
  assert.equal(match.score, 10);
  assert.deepEqual(match.scoreReceipt, {
    sharedInterestCount: 1,
    sharedInterestPoints: 3,
    localCauseOverlapCount: 1,
    localCausePoints: 2,
    visitorCauseOverlapCount: 1,
    visitorCausePoints: 2,
    urgency: 3,
    urgencyPoints: 3,
    endorsementRawScore: 0,
    endorsementPoints: 0,
    total: 10,
  });
  assert.equal(rankMatch(
    { id: 'visitor-1', name: 'Kai', interests: ['ocean'] },
    { locals: [local('untrusted', { verified: false })], causes: [cause('reef')], endorsements: [] },
  ), null);
});

test('rankMatch canonicalizes duplicate tags before scoring', () => {
  const match = rankMatch(
    { id: 'visitor-1', name: 'Kai', interests: ['ocean', ' Ocean ', 'OCEAN'] },
    { locals: [local('keoni')], causes: [cause('reef')], endorsements: [] },
  );
  assert.equal(match.score, 10);
  assert.deepEqual(match.blocks[0].sharedInterests, ['ocean']);
});

test('rankMatch has a stable id tie-break independent of Dynamo result order', () => {
  const visitor = { id: 'visitor-1', name: 'Kai', interests: ['ocean'] };
  const inputs = { locals: [local('z'), local('a')], causes: [cause('z'), cause('a')], endorsements: [] };
  const reversed = {
    locals: [...inputs.locals].reverse(),
    causes: [...inputs.causes].reverse(),
    endorsements: [],
  };
  assert.equal(rankMatch(visitor, inputs).localId, 'a');
  assert.equal(rankMatch(visitor, inputs).causeId, 'a');
  assert.deepEqual(rankMatch(visitor, inputs), rankMatch(visitor, reversed));
});

test('rankMatch emits the cause id and source evidence required by the Match contract', () => {
  const match = rankMatch(
    { id: 'visitor-1', name: 'Kai', interests: ['ocean'] },
    { locals: [local('keoni')], causes: [cause('reef')], endorsements: [] },
  );
  assert.equal(match.causeId, 'reef');
  assert.equal(match.blocks.length, 3);
  assert.equal(match.blocks[1].sourceUrl, 'https://example.test/reef');
  assert.equal(match.blocks[1].fetchedAt, '2026-08-29T00:00:00.000Z');
  assert.equal(match.scoreReceipt.total, match.score);
});

test('deriveMemoryTags maps kiʻi memory text onto canonical tags via whole-word synonyms', () => {
  const memories = [
    'User cares deeply about the Coral Reef Alliance and their watershed restoration work.',
    'Another cause close to my heart is the Maui Humane Society and their beach clean-up walks with shelter dogs.',
  ];
  const derived = deriveMemoryTags(memories);
  assert.ok(derived.includes('reef'), 'coral → reef');
  assert.ok(derived.includes('ocean'), 'beach → ocean');
  assert.ok(derived.includes('wildlife'), 'shelter dogs → wildlife');
  assert.ok(derived.includes('farming'), 'watershed restoration → farming');
  assert.ok(!derived.includes('cooking'), 'no cooking words present');
});

test('deriveMemoryTags requires whole words, ranks by hit count, and stays deterministic', () => {
  assert.deepEqual(deriveMemoryTags(['a new season of reasons']), [],
    'season must not match sea');
  const derived = deriveMemoryTags([
    'the reef needs help', 'reef divers wanted', 'one hike this weekend',
  ]);
  assert.deepEqual(derived[0], 'reef', 'two reef memories outrank one hiking memory');
  assert.deepEqual(derived, deriveMemoryTags([
    'one hike this weekend', 'reef divers wanted', 'the reef needs help',
  ]), 'memory order must not change the result');
});

test('deriveMemoryTags matches record vocabulary beyond the built-in synonym map, uncapped', () => {
  const vocabulary = [
    't01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10',
    't11', 't12', 'food-security', 'Lahaina-rebuild',
  ];
  const derived = deriveMemoryTags(
    ['I volunteer for the lahaina-rebuild effort and a food-security pantry.'],
    vocabulary,
  );
  assert.ok(derived.includes('Lahaina-rebuild'), 'vocabulary entry 14 still matches');
  assert.ok(derived.includes('food-security'));
});

test('deriveMemoryTags bounds its input and ignores non-string memories', () => {
  assert.deepEqual(deriveMemoryTags(['', '   ', 42, null, {}]), []);
  assert.deepEqual(deriveMemoryTags('reef'), []);
  const farAway = `${'x '.repeat(MEMORY_TEXT_MAX)}reef`;
  assert.deepEqual(deriveMemoryTags([farAway]), [],
    'text beyond the per-memory cap is not scanned');
  const beyondList = Array.from({ length: MEMORY_LIST_MAX + 5 }, (_, index) =>
    index < MEMORY_LIST_MAX ? 'nothing here' : 'reef');
  assert.deepEqual(deriveMemoryTags(beyondList), [],
    'memories beyond the list cap are not scanned');
});
