import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBoardAiContext, buildNoteAiContext, buildContextAiPrompt, buildContextAiTurnPrompt } from '../frontend/src/features/ai/context-ai';

test('builds bounded note context without attachment payloads', () => {
  const context = buildNoteAiContext({ title: '研究笔记', content: '正文'.repeat(5000) });
  assert.match(context, /页面：研究笔记/);
  assert.match(context, /正文/);
  assert.ok(context.length <= 12000);
  assert.doesNotMatch(context, /base64|data:image/u);
});

test('builds board context from task metadata only', () => {
  const context = buildBoardAiContext('项目看板', [{ title: '发布计划', status: '进行中', priority: '高', dueAt: '2026-09-01', description: '不应注入详情' }]);
  assert.match(context, /看板：项目看板/);
  assert.match(context, /发布计划/);
  assert.doesNotMatch(context, /不应注入详情/u);
});

test('builds an explicit read-only context prompt', () => {
  const prompt = buildContextAiPrompt('页面：研究笔记\n正文：内容', '帮我找出三个重点');
  assert.match(prompt, /帮我找出三个重点/);
  assert.match(prompt, /仅基于以下上下文/);
  assert.match(prompt, /不要修改页面或任务/);
});

test('carries a bounded short conversation history into the next turn', () => {
  const prompt = buildContextAiTurnPrompt([{ role: 'user', content: '第一个问题' }, { role: 'assistant', content: '第一个回答' }], '继续展开');
  assert.match(prompt, /第一个问题/);
  assert.match(prompt, /继续展开/);
});
