import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch, pickMatch, normalizeGender } from '../renderer/matching.js';
import { LOCALS, EXPERIENCES } from '../renderer/matchData.js';

const REPORT = {
  gender: 'female',
  brands: ['Nike'],
  clothingStyle: ['athleisure'],
  colors: ['black'],
  accessories: ['headphones'],
};

describe('normalizeGender', () => {
  test('maps variants and defaults to unknown', () => {
    assert.equal(normalizeGender('Female'), 'female');
    assert.equal(normalizeGender('MAN'), 'male');
    assert.equal(normalizeGender('nonbinary'), 'unknown');
    assert.equal(normalizeGender(''), 'unknown');
    assert.equal(normalizeGender(undefined), 'unknown');
  });
});

describe('scoreMatch', () => {
  test('weights brand overlap heaviest and explains reasons', () => {
    const noelani = LOCALS.find((l) => l.id === 'noelani');
    const { score, reasons } = scoreMatch(REPORT, noelani);
    // Nike brand (3) + athleisure style (2) + black color (1) + headphones (1)
    assert.equal(score, 7);
    assert.equal(reasons.length, 4);
    assert.ok(reasons[0].includes('Nike'));
  });

  test('case-insensitive and substring-tolerant tag overlap', () => {
    const local = { brands: ['NIKE'], styles: ['vintage aloha shirt'], colors: [], accessories: [] };
    const { score } = scoreMatch(
      { brands: ['nike'], clothingStyle: ['aloha shirt'], colors: [], accessories: [] },
      local
    );
    assert.equal(score, 5);
  });

  test('empty report scores zero with no reasons', () => {
    const { score, reasons } = scoreMatch(null, LOCALS[0]);
    assert.equal(score, 0);
    assert.deepEqual(reasons, []);
  });
});

describe('pickMatch', () => {
  test('gender gates strictly when known', () => {
    const match = pickMatch(REPORT, LOCALS);
    assert.equal(match.local.gender, 'female');
    assert.equal(match.local.id, 'noelani'); // highest score in the female pool
    assert.equal(match.pool, LOCALS.filter((l) => l.gender === 'female').length);
  });

  test('unknown gender matches the whole pool', () => {
    const match = pickMatch({ ...REPORT, gender: undefined }, LOCALS);
    assert.equal(match.pool, LOCALS.length);
    assert.equal(match.local.id, 'noelani'); // Nike/athleisure still wins overall
  });

  test('no report still produces a match, seed breaks the tie deterministically', () => {
    const a = pickMatch(null, LOCALS, { seed: 0 });
    const b = pickMatch(null, LOCALS, { seed: 1 });
    assert.ok(a.local && b.local);
    assert.equal(a.score, 0);
    assert.notEqual(a.local.id, b.local.id);
    assert.equal(pickMatch(null, LOCALS, { seed: 0 }).local.id, a.local.id);
  });

  test('returns null when no local passes the gate', () => {
    assert.equal(pickMatch(REPORT, []), null);
  });
});

describe('match data integrity', () => {
  test('locals carry every tag field and a gender', () => {
    for (const local of LOCALS) {
      assert.ok(local.id && local.name && local.blurb, local.id);
      assert.ok(['female', 'male'].includes(local.gender), local.id);
      for (const field of ['brands', 'styles', 'colors', 'accessories']) {
        assert.ok(Array.isArray(local[field]) && local[field].length, `${local.id}.${field}`);
      }
    }
  });

  test('experiences have unique ids and wheel-sized labels', () => {
    const ids = new Set(EXPERIENCES.map((e) => e.id));
    assert.equal(ids.size, EXPERIENCES.length);
    for (const exp of EXPERIENCES) {
      assert.ok(exp.short.length <= 14, `${exp.id} label too long for a wedge`);
      assert.ok(exp.title);
    }
  });
});
