import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecentSlashCommands, rememberSlashCommand, slashCommandGroups } from '../frontend/src/features/tasks/slash-commands';

test('restores a bounded unique recent command list and ignores damaged cache data', () => {
  assert.deepEqual(parseRecentSlashCommands('{broken'), []);
  assert.deepEqual(parseRecentSlashCommands('["heading1","heading1","unknown","table"]'), ['heading1', 'table']);
  assert.deepEqual(rememberSlashCommand(['table', 'heading1'], 'table'), ['table', 'heading1']);
  assert.equal(rememberSlashCommand(['heading1', 'heading2', 'table', 'callout', 'details', 'codeBlock'], 'paragraph').length, 6);
});

test('groups an empty slash menu by recency and searches labels, ids, and aliases', () => {
  const groups = slashCommandGroups('', ['table', 'heading1']);
  assert.deepEqual(groups[0]?.commands.map((command) => command.id), ['table', 'heading1']);
  assert.equal(groups.some((group) => group.label === '基础块'), true);
  assert.equal(groups.some((group) => group.label === '媒体'), true);
  assert.deepEqual(slashCommandGroups('表格', []).flatMap((group) => group.commands.map((command) => command.id)), ['table']);
  assert.deepEqual(slashCommandGroups('todo', []).flatMap((group) => group.commands.map((command) => command.id)), ['taskList']);
  assert.deepEqual(slashCommandGroups('附件', []).flatMap((group) => group.commands.map((command) => command.id)), ['attachment']);
});
