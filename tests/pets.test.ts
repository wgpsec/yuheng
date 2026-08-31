import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { deleteCodexPetPackage, importCodexPetPackage, inspectCodexPets, isCodexPetRuntimeUsable, normalizePetImageSize, scanCodexPets, validateCodexPetManifest } from '../electron/pets';

function vp8xWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8);
  buffer.write('VP8X', 12);
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

describe('Codex Pet compatibility', () => {
  it('does not turn an empty native image size into a dimensions error', () => {
    assert.equal(normalizePetImageSize({ width: 0, height: 0 }), undefined);
    assert.deepEqual(normalizePetImageSize({ width: 1_536, height: 1_872 }), { width: 1_536, height: 1_872 });
    const report = validateCodexPetManifest({ id: 'guga', displayName: 'Guga', spritesheetPath: 'spritesheet.webp', rootPath: '.', source: 'codex', columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 }, { width: 0, height: 0 });
    assert.equal(report.issues.some((item) => item.code === 'dimensions'), false);
  });

  it('reports state fallbacks and actionable sprite compatibility issues', () => {
    const report = validateCodexPetManifest({
      id: 'report-me',
      displayName: 'Report me',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      rootPath: '/tmp/report-me',
      source: 'codex',
      columns: 8,
      rows: 11,
      cellWidth: 192,
      cellHeight: 208,
      animations: { idle: { row: 0, durations: [80, 120] } },
    }, { width: 1_500, height: 2_288, blankFrameIndices: [2] });
    assert.equal(report.status, 'invalid');
    assert.equal(report.actual.width, 1_500);
    assert.ok(report.issues.some((issue) => issue.code === 'dimensions'));
    assert.ok(report.issues.some((issue) => issue.code === 'blank_frames'));
    assert.ok(report.issues.some((issue) => issue.code === 'missing_states'));
    assert.equal(report.states.find((state) => state.state === 'idle')?.source, 'manifest');
    assert.equal(report.states.find((state) => state.state === 'thinking')?.fallback, true);
  });

  it('keeps a Codex package with only missing optional states runtime-usable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pet-fallback-'));
    try {
      await mkdir(path.join(root, 'guga'));
      await writeFile(path.join(root, 'guga', 'pet.json'), JSON.stringify({ id: 'guga', displayName: 'Guga', spritesheetPath: 'spritesheet.webp' }));
      await writeFile(path.join(root, 'guga', 'spritesheet.webp'), vp8xWebp(1_536, 1_872));
      const [entry] = await inspectCodexPets([{ path: root, source: 'codex' }]);
      assert.equal(entry.report.status, 'warning');
      assert.equal(isCodexPetRuntimeUsable(entry), true);
      assert.ok(entry.report.issues.some((item) => item.code === 'missing_states' && item.severity === 'warning'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps malformed packages in the management catalog without exposing them to the runtime', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pet-catalog-'));
    try {
      await mkdir(path.join(root, 'good'));
      await writeFile(path.join(root, 'good', 'pet.json'), JSON.stringify({ id: 'good', displayName: 'Good', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' }));
      await writeFile(path.join(root, 'good', 'spritesheet.webp'), vp8xWebp(1_536, 2_288));
      await mkdir(path.join(root, 'broken'));
      await writeFile(path.join(root, 'broken', 'pet.json'), JSON.stringify({ displayName: 'Broken', spritesheetPath: '../outside.webp' }));

      const catalog = await inspectCodexPets([{ path: root, source: 'codex' }]);
      assert.deepEqual(catalog.map((entry) => entry.id), ['broken', 'good']);
      assert.equal(catalog[0].report.status, 'invalid');
      assert.ok(catalog[0].report.issues.some((issue) => issue.code === 'manifest'));
      assert.equal(catalog[1].report.actual.width, 1_536);
      assert.deepEqual((await scanCodexPets([{ path: root, source: 'codex' }])).map((pet) => pet.id), ['good']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('imports a validated package and refuses to delete the active skin', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pet-files-'));
    const source = path.join(root, 'source', 'jade');
    const managed = path.join(root, 'managed');
    try {
      await mkdir(source, { recursive: true });
      await writeFile(path.join(source, 'pet.json'), JSON.stringify({ id: 'jade', displayName: 'Jade', spritesheetPath: 'spritesheet.webp' }));
      await writeFile(path.join(source, 'spritesheet.webp'), vp8xWebp(1_536, 1_872));

      const imported = await importCodexPetPackage(source, managed);
      assert.equal(imported.id, 'jade');
      assert.deepEqual((await scanCodexPets([{ path: managed, source: 'yuheng' }])).map((pet) => pet.id), ['jade']);
      await assert.rejects(deleteCodexPetPackage('jade', [managed], 'jade'), /默认皮肤/);
      assert.equal((await scanCodexPets([{ path: managed, source: 'yuheng' }])).length, 1);
      await deleteCodexPetPackage('jade', [managed]);
      assert.equal((await scanCodexPets([{ path: managed, source: 'yuheng' }])).length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it('accepts bounded per-state animation metadata without weakening row validation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pets-animations-'));
    try {
      await mkdir(path.join(root, 'custom'));
      await writeFile(path.join(root, 'custom', 'pet.json'), JSON.stringify({
        id: 'custom',
        displayName: 'Custom',
        spriteVersionNumber: 2,
        spritesheetPath: 'spritesheet.webp',
        animations: {
          thinking: { row: 8, durations: [80, 120, 200] },
          error: { row: 12, durations: [100] },
          attention: { row: 4, durations: [10] },
        },
      }));
      await writeFile(path.join(root, 'custom', 'spritesheet.webp'), 'webp');
      const [pet] = await scanCodexPets([{ path: root, source: 'codex' }]);
      assert.deepEqual(pet.animations, { thinking: { row: 8, durations: [80, 120, 200] } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports invalid raw animation metadata instead of silently treating it as a fallback', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pets-invalid-animation-'));
    try {
      await mkdir(path.join(root, 'bad-animation'));
      await writeFile(path.join(root, 'bad-animation', 'pet.json'), JSON.stringify({ id: 'bad-animation', displayName: 'Bad animation', spritesheetPath: 'spritesheet.webp', animations: { thinking: { row: 1, durations: [4] } } }));
      await writeFile(path.join(root, 'bad-animation', 'spritesheet.webp'), vp8xWebp(1_536, 1_872));
      const [entry] = await inspectCodexPets([{ path: root, source: 'codex' }]);
      assert.equal(entry.report.status, 'invalid');
      assert.ok(entry.report.issues.some((issue) => issue.code === 'frame_rate'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
