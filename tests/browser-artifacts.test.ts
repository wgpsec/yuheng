import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BrowserArtifactStore, browserImagesFromToolResult } from '../electron/browser-artifacts';

describe('BrowserArtifactStore', () => {
  it('stores screenshots behind a managed URL and rejects paths outside its root', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-browser-artifacts-'));
    const artifacts = new BrowserArtifactStore(dataDir);
    try {
      const saved = artifacts.saveImage(Buffer.from('png-data').toString('base64'), 'image/png');
      assert.equal(saved.kind, 'browser_screenshot');
      const computer = artifacts.saveImage(Buffer.from('computer-png').toString('base64'), 'image/png', 'computer_screenshot');
      assert.equal(computer.kind, 'computer_screenshot');
      const savedPath = artifacts.resolveUrl(saved.url);
      assert.equal(fs.readFileSync(savedPath, 'utf8'), 'png-data');
      assert.equal(fs.statSync(savedPath).mode & 0o777, 0o600);
      assert.throws(() => artifacts.resolveUrl('file:///tmp/private.png'), /Invalid browser artifact URL/);
      assert.throws(() => artifacts.resolveUrl('yuheng-browser-artifact://local/../private.png'), /Invalid browser artifact URL/);
      assert.throws(() => artifacts.resolveUrl('yuheng-browser-artifact://local/------------------------------------.png'), /Invalid browser artifact URL/);
      assert.throws(() => artifacts.resolveUrl(`${saved.url}?download=1`), /Invalid browser artifact URL/);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('removes expired managed files even when their database metadata is already gone', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-browser-artifacts-'));
    const artifacts = new BrowserArtifactStore(dataDir);
    try {
      const expired = artifacts.saveImage(Buffer.from('old').toString('base64'), 'image/png');
      const retained = artifacts.saveImage(Buffer.from('new').toString('base64'), 'image/png');
      const oldTime = new Date('2025-01-01T00:00:00.000Z');
      fs.utimesSync(artifacts.resolveUrl(expired.url), oldTime, oldTime);

      assert.equal(artifacts.deleteFilesBefore(new Date('2025-02-01T00:00:00.000Z')), 1);
      assert.equal(fs.existsSync(artifacts.resolveUrl(expired.url)), false);
      assert.equal(fs.existsSync(artifacts.resolveUrl(retained.url)), true);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('extracts image blocks without treating text or nested arbitrary data as screenshots', () => {
    assert.deepEqual(browserImagesFromToolResult({ content: [
      { type: 'text', text: 'metadata' },
      { type: 'image', data: 'cG5n', mimeType: 'image/png' },
      { type: 'image', data: 42, mimeType: 'image/png' },
    ] }), [{ data: 'cG5n', mimeType: 'image/png' }]);
    assert.deepEqual(browserImagesFromToolResult({ details: { content: [{ type: 'image', data: 'hidden', mimeType: 'image/png' }] } }), []);
  });
});
