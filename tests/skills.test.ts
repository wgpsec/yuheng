import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importSkill, listSkills } from '../electron/skills';

describe('user skills', () => {
  it('imports a directory or SKILL.md using frontmatter metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-skill-'));
    const directory = path.join(root, 'review');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'SKILL.md'), '---\nname: Code Review\ndescription: Review changes\n---\n# Rules\n');
    try {
      const imported = importSkill(directory);
      assert.deepEqual(imported, {
        id: imported.id,
        name: 'Code Review',
        description: 'Review changes',
        path: directory,
        enabled: false,
      });
      assert.match(imported.id, /^user-/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('marks unavailable registrations without exposing them as loadable', () => {
    const entries = listSkills('/nonexistent', [{ id: 'user-missing', name: 'Missing', description: '', path: '/nonexistent/skill', enabled: true }]);
    const missing = entries.find((entry) => entry.id === 'user-missing');
    assert.equal(missing?.available, false);
  });
});
