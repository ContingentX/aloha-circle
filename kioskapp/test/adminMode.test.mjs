import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminMode } from '../renderer/adminMode.js';

function type(mode, text) {
  let changed = false;
  for (const ch of text) changed = mode.key(ch) || changed;
  return changed;
}

describe('createAdminMode', () => {
  test('starts hidden: no switch, no debug visuals', () => {
    const mode = createAdminMode();
    assert.equal(mode.armed, false);
    assert.equal(mode.debug, false);
  });

  test('typing the sequence arms the switch with debug on', () => {
    const mode = createAdminMode();
    assert.equal(type(mode, 'aloha'), true);
    assert.equal(mode.armed, true);
    assert.equal(mode.debug, true);
  });

  test('sequence is case-insensitive', () => {
    const mode = createAdminMode();
    assert.equal(type(mode, 'ALoHa'), true);
    assert.equal(mode.armed, true);
  });

  test('sequence matches through noise and overlapping prefixes', () => {
    const mode = createAdminMode();
    assert.equal(type(mode, 'xxalo'), false);
    assert.equal(mode.armed, false);
    // restart mid-way: "alo" + "aloha" — rolling buffer must still match
    assert.equal(type(mode, 'aloha'), true);
    assert.equal(mode.armed, true);
  });

  test('partial sequence does not arm', () => {
    const mode = createAdminMode();
    assert.equal(type(mode, 'aloh'), false);
    assert.equal(mode.armed, false);
    assert.equal(mode.debug, false);
  });

  test('non-character keys are ignored', () => {
    const mode = createAdminMode();
    type(mode, 'alo');
    assert.equal(mode.key('Shift'), false); // multi-char key name
    assert.equal(mode.key(undefined), false);
    assert.equal(type(mode, 'ha'), true);
    assert.equal(mode.armed, true);
  });

  test('keys while armed change nothing', () => {
    const mode = createAdminMode();
    type(mode, 'aloha');
    assert.equal(type(mode, 'aloha'), false);
    assert.equal(mode.armed, true);
    assert.equal(mode.debug, true);
  });

  test('switch off hides visuals and the switch itself', () => {
    const mode = createAdminMode();
    type(mode, 'aloha');
    mode.setDebug(false);
    assert.equal(mode.debug, false);
    assert.equal(mode.armed, false);
  });

  test('after switching off, the sequence re-arms', () => {
    const mode = createAdminMode();
    type(mode, 'aloha');
    mode.setDebug(false);
    assert.equal(type(mode, 'aloha'), true);
    assert.equal(mode.armed, true);
    assert.equal(mode.debug, true);
  });

  test('switch can toggle debug off/on while staying armed only when on', () => {
    const mode = createAdminMode();
    type(mode, 'aloha');
    mode.setDebug(true); // no-op, stays on
    assert.equal(mode.armed, true);
    assert.equal(mode.debug, true);
  });

  test('custom sequence is honored', () => {
    const mode = createAdminMode({ sequence: 'mahalo' });
    assert.equal(type(mode, 'aloha'), false);
    assert.equal(type(mode, 'mahalo'), true);
    assert.equal(mode.armed, true);
  });
});
