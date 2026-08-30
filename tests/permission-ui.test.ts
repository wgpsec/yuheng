import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('conversation permission controls', () => {
  it('offers all permission modes and confirms full session access before saving it', () => {
    const composer = readFileSync(new URL('../frontend/src/features/conversation/workspace/composer.tsx', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../frontend/src/production/ProductionRenderer.tsx', import.meta.url), 'utf8');

    assert.match(composer, /value: 'cautious'/);
    assert.match(composer, /value: 'smart'/);
    assert.match(composer, /value: 'full_session'/);
    assert.match(renderer, /if \(mode === 'full_session'\)[\s\S]*?setPermissionConfirmationOpen\(true\)/);
    assert.match(renderer, /savePermissionMode\('full_session'\)/);
    assert.match(renderer, /此设置会在退出应用后失效/);
  });
});
