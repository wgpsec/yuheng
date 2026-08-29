import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoteAiResult } from '../frontend/src/features/notes/note-ai';

test('applies note AI results with a reversible snapshot', () => {
  assert.deepEqual(applyNoteAiResult('原始内容', 'summarize', '摘要内容'), { content: '摘要内容', previousContent: '原始内容' });
  assert.deepEqual(applyNoteAiResult('原始内容', 'extract_tasks', '- [ ] 跟进发布'), { content: '原始内容\n\n- [ ] 跟进发布', previousContent: '原始内容' });
  assert.deepEqual(applyNoteAiResult('', 'extract_tasks', '- [ ] 新任务'), { content: '- [ ] 新任务', previousContent: '' });
});
