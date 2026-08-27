import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { releaseNotes } from '../frontend/src/features/settings/releases.ts';

test('latest release note matches the application version', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

  assert.equal(releaseNotes[0]?.version, packageJson.version);
});

test('release notes are ordered newest first without duplicate versions', () => {
  const versions = releaseNotes.map((release) => release.version);
  const descending = [...versions].sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

  assert.deepEqual(versions, descending);
  assert.equal(new Set(versions).size, versions.length);
  assert.ok(releaseNotes.every((release) => release.changes.length > 0));
});

test('repository changelog contains every in-app release note', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

  for (const release of releaseNotes) {
    assert.match(changelog, new RegExp(`^## ${release.version} - ${release.title}$`, 'm'));
    for (const change of release.changes) assert.ok(changelog.includes(`- ${change}`));
  }
});
