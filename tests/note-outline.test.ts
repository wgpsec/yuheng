import assert from 'node:assert/strict';
import test from 'node:test';
import { noteOutline } from '../frontend/src/features/notes/note-outline';

test('builds an ordered H1-H3 outline while ignoring fenced code headings', () => {
  const markdown = `# 项目计划

## 里程碑

\`\`\`markdown
# 代码示例，不是标题
\`\`\`

### 风险

#### 不进入目录

## 里程碑`;
  assert.deepEqual(noteOutline(markdown), [
    { index: 0, level: 1, text: '项目计划' },
    { index: 1, level: 2, text: '里程碑' },
    { index: 2, level: 3, text: '风险' },
    { index: 3, level: 2, text: '里程碑' },
  ]);
});
