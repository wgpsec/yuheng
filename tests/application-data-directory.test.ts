import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApplicationDataDirectory } from '../electron/app/application-data-directory';

const appData = '/Users/alice/Library/Application Support';

test('uses stable and isolated data directories for packaged and development applications', () => {
  assert.equal(resolveApplicationDataDirectory(appData, true), `${appData}/yuheng`);
  assert.equal(resolveApplicationDataDirectory(appData, false), `${appData}/yuheng-dev`);
});

test('allows development startup to explicitly use production data', () => {
  assert.equal(resolveApplicationDataDirectory(appData, false, 'production'), `${appData}/yuheng`);
  assert.equal(resolveApplicationDataDirectory(appData, false, 'development'), `${appData}/yuheng-dev`);
});

test('packaged startup always uses production data and invalid profiles are rejected', () => {
  assert.equal(resolveApplicationDataDirectory(appData, true, 'development'), `${appData}/yuheng`);
  assert.throws(() => resolveApplicationDataDirectory(appData, false, 'other'), /YUHENG_DATA_PROFILE/);
});
