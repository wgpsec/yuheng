import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampPetPosition, restorePetPosition, snapPetPosition, stepPetInertia, type PetDisplay } from '../electron/pet-desktop-behavior';
import { idleAnimationDelay } from '../frontend/src/production/pet-animation';

const displays: PetDisplay[] = [
  { id: 'primary', primary: true, bounds: { x: 0, y: 0, width: 1_440, height: 900 }, workArea: { x: 0, y: 25, width: 1_440, height: 875 } },
  { id: 'external', bounds: { x: 1_440, y: 0, width: 1_920, height: 1_080 }, workArea: { x: 1_440, y: 25, width: 1_920, height: 1_055 } },
];

describe('desktop pet behaviour', () => {
  it('restores a position by display and clamps it when that display is gone', () => {
    const restored = restorePetPosition({ version: 1, lastDisplayId: 'external', byDisplay: { external: { x: 2_900, y: 900 } } }, displays, { width: 188, height: 188 });
    assert.equal(restored.display.id, 'external');
    assert.deepEqual(restored.position, { x: 2_900, y: 892 });

    const fallback = restorePetPosition({ version: 1, lastDisplayId: 'missing', byDisplay: { missing: { x: 3_000, y: 800 }, primary: { x: 200, y: 300 } } }, displays.slice(0, 1), { width: 188, height: 188 });
    assert.equal(fallback.display.id, 'primary');
    assert.deepEqual(fallback.position, { x: 200, y: 300 });
  });

  it('supports legacy single-position files and keeps the pet visible', () => {
    const restored = restorePetPosition({ x: -500, y: -300 }, displays, { width: 188, height: 188 });
    assert.equal(restored.display.id, 'primary');
    assert.deepEqual(restored.position, { x: 0, y: 25 });
  });

  it('snaps only the near edge and leaves interior positions unchanged', () => {
    const display = displays[0];
    assert.deepEqual(snapPetPosition({ x: 8, y: 412 }, display, { width: 188, height: 188 }, 18), { x: 0, y: 412 });
    assert.deepEqual(snapPetPosition({ x: 500, y: 412 }, display, { width: 188, height: 188 }, 18), { x: 500, y: 412 });
    assert.deepEqual(snapPetPosition({ x: 1_258, y: 710 }, display, { width: 188, height: 188 }, 18), { x: 1_252, y: 712 });
  });

  it('clamps inertial steps and settles when velocity is negligible', () => {
    const display = displays[0];
    const step = stepPetInertia({ x: 1_000, y: 400 }, { x: 90, y: 0 }, display, { width: 188, height: 188 }, { friction: 0.5, bounce: false });
    assert.deepEqual(step.position, { x: 1_090, y: 400 });
    assert.deepEqual(step.velocity, { x: 45, y: 0 });
    assert.equal(step.done, false);

    const edge = stepPetInertia({ x: 1_252, y: 400 }, { x: 90, y: 0 }, display, { width: 188, height: 188 }, { friction: 0.5, bounce: true });
    assert.equal(edge.position.x, 1_252);
    assert.ok(edge.velocity.x < 0);
    assert.equal(stepPetInertia({ x: 200, y: 200 }, { x: 0.01, y: 0.01 }, display, { width: 188, height: 188 }, { friction: 0.5, bounce: false }).done, true);
  });

  it('limits random idle pauses to avoid rapid repeated idle effects', () => {
    assert.equal(idleAnimationDelay(5, 5, 320, () => 0), 1_520);
    assert.equal(idleAnimationDelay(5, 5, 320, () => 0.99), 3_500);
    assert.equal(idleAnimationDelay(0, 2, 320, () => 0), 320);
    assert.equal(idleAnimationDelay(1, 5, 320, () => 0), 320);
  });
});
