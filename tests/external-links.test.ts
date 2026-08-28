import assert from 'node:assert/strict';
import test from 'node:test';
import { externalHttpUrl } from '../electron/external-links.ts';

test('allows only http and https external links', () => {
  assert.equal(externalHttpUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(externalHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(externalHttpUrl('javascript:alert(1)'), null);
  assert.equal(externalHttpUrl('file:///tmp/example.txt'), null);
  assert.equal(externalHttpUrl('not a url'), null);
});
