import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { scanCodexPets } from '../electron/pets';

describe('Codex Pet compatibility', () => {
  it('scans valid v1/v2 packages and ignores malformed or unsafe entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pets-'));
    try {
      await mkdir(path.join(root, 'valid-v1'));
      await writeFile(path.join(root, 'valid-v1', 'pet.json'), JSON.stringify({ id: 'valid-v1', displayName: 'V1', spritesheetPath: 'spritesheet.webp' }));
      await writeFile(path.join(root, 'valid-v1', 'spritesheet.webp'), 'webp');
      await mkdir(path.join(root, 'valid-v2'));
      await writeFile(path.join(root, 'valid-v2', 'pet.json'), JSON.stringify({ id: 'valid-v2', displayName: 'V2', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' }));
      await writeFile(path.join(root, 'valid-v2', 'spritesheet.webp'), 'webp');
      await mkdir(path.join(root, 'unsafe'));
      await writeFile(path.join(root, 'unsafe', 'pet.json'), JSON.stringify({ id: 'unsafe', displayName: 'Unsafe', spritesheetPath: '../spritesheet.webp' }));
      await mkdir(path.join(root, 'missing'));
      await writeFile(path.join(root, 'missing', 'pet.json'), JSON.stringify({ id: 'missing', displayName: 'Missing', spritesheetPath: 'spritesheet.webp' }));
      const pets = await scanCodexPets([{ path: root, source: 'codex' }]);
      assert.deepEqual(pets.map((pet) => pet.id), ['valid-v1', 'valid-v2']);
      assert.equal(pets[0].rows, 9);
      assert.equal(pets[1].rows, 11);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
