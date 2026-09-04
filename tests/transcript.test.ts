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

  it('shows the structured Computer Use action outcome', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [],
      isThinking: false,
      activities: [{
        id: 'act-call',
        toolName: 'act_ui',
        status: 'failed' as const,
        actionOutcome: { status: 'not_dispatched' as const, reason: 'visual_observation_unavailable', dispatchedActions: 0 },
      }],
    }));

    assert.match(html, />未执行</);
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

  it('aligns user and assistant messages with distinct role classes', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [
        { id: 'user-role', role: 'user' as const, content: '右侧消息', time: '10:00' },
        { id: 'assistant-role', role: 'assistant' as const, content: '左侧回复', time: '10:01' },
      ],
      isThinking: false,
    }));

    assert.match(html, /class="message user"/);
    assert.match(html, /class="message assistant"/);
  });

  it('renders one duration for the run associated with a user turn', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [
        { id: 'user-duration', role: 'user' as const, content: '耗时问题', time: '10:00' },
        { id: 'assistant-duration', role: 'assistant' as const, content: '已完成', time: '10:00' },
      ],
      runs: [{ id: 'run-duration', conversationId: 'conversation-1', inputMessageId: 'user-duration', status: 'completed' as const, error: null, startedAt: '2026-08-28T10:00:00.000Z', finishedAt: '2026-08-28T10:00:02.400Z', usage: null, activities: [] }],
      isThinking: false,
    }));

    assert.equal((html.match(/本轮运行耗时/g) ?? []).length, 1);
    assert.match(html, /用时 2 秒/);
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

  it('collapses consecutive tool activities into a closed execution group', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [],
      isThinking: false,
      activities: [
        { id: 'tool-1', toolName: 'task_list', status: 'completed' as const },
        { id: 'tool-2', toolName: 'task_list', status: 'completed' as const },
      ],
    }));

    assert.match(html, /class="tool-activity-group"/);
    assert.match(html, />执行记录</);
    assert.match(html, />2 项</);
    assert.doesNotMatch(html, /<details class="tool-activity-group" open/);
    assert.equal((html.match(/class="tool-activity is-completed"/g) ?? []).length, 2);
  });

  it('renders assistant links as external, non-navigating links', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [{ id: 'assistant-link', role: 'assistant' as const, content: '[打开](https://example.com)', time: '10:00' }],
      isThinking: false,
    }));
    assert.match(html, /href="https:\/\/example.com"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noreferrer noopener"/);
  });
});
