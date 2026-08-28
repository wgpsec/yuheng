import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { taskIdentityFromToolActivity, Transcript, type TranscriptMessage } from '../frontend/src/features/conversation/workspace/transcript';

describe('Transcript timeline', () => {
  it('extracts task identity only from task mutation results', () => {
    assert.deepEqual(taskIdentityFromToolActivity({ toolName: 'task_create', output: JSON.stringify({ task: { id: 'task-1', boardId: 'board-1' } }) }), { taskId: 'task-1', boardId: 'board-1' });
    assert.deepEqual(taskIdentityFromToolActivity({ toolName: 'task_list', output: JSON.stringify({ task: { id: 'task-1', boardId: 'board-1' } }) }), null);
    assert.equal(taskIdentityFromToolActivity({ toolName: 'task_update', output: '{bad' }), null);
    assert.equal(taskIdentityFromToolActivity({ toolName: 'task_update', output: JSON.stringify({ task: { id: 'task-1' } }) }), null);
  });

  it('renders an action for a completed task mutation', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [],
      isThinking: false,
      activities: [{ id: 'task-call', toolName: 'task_create', status: 'completed', output: JSON.stringify({ task: { id: 'task-1', boardId: 'board-1' } }) }],
      onOpenTask: () => undefined,
    }));
    assert.match(html, />打开任务</);
  });
  it('keeps live assistant replies between their surrounding user messages', () => {
    const messages: TranscriptMessage[] = [
      { id: 'user-1', role: 'user', content: 'first-question', time: '12:21', createdAt: '2026-08-27T04:21:24.195Z' },
      { id: 'assistant-1', role: 'assistant', content: 'first-answer', time: '刚刚' },
      { id: 'user-2', role: 'user', content: 'second-question', time: '12:21', createdAt: '2026-08-27T04:21:28.881Z' },
      { id: 'assistant-2', role: 'assistant', content: 'second-answer', time: '刚刚' },
    ];

    const html = renderToStaticMarkup(createElement(Transcript, { messages, isThinking: false }));

    assert.ok(html.indexOf('first-question') < html.indexOf('first-answer'));
    assert.ok(html.indexOf('first-answer') < html.indexOf('second-question'));
    assert.ok(html.indexOf('second-question') < html.indexOf('second-answer'));
  });

  it('marks persisted messages as global-search navigation targets', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [{ id: 'message-target-1', role: 'user' as const, content: '定位正文', time: '10:00' }],
      isThinking: false,
      requestedMessageId: 'message-target-1',
    }));

    assert.match(html, /data-message-id="message-target-1"/);
  });

  it('renders a persisted Browser Use screenshot in its tool activity', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [],
      isThinking: false,
      activities: [{
        id: 'tool-screenshot',
        toolName: 'browser_screenshot',
        status: 'completed' as const,
        artifacts: [{
          id: 'artifact-1',
          kind: 'browser_screenshot' as const,
          mimeType: 'image/png',
          size: 1024,
          url: 'yuheng-browser-artifact://local/artifact-1.png',
        }],
      }],
    }));

    assert.match(html, /<img[^>]+src="yuheng-browser-artifact:\/\/local\/artifact-1\.png"/);
    assert.match(html, /页面截图/);
  });
});
