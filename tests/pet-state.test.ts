import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPetState, parsePetOpenTarget, parsePetFeedback, petFeedbackForRunEvent, petStateForRunEvent, petToolDisplayName, PetStateCoordinator } from '../electron/pet-state';

describe('desktop pet runtime states', () => {
  it('accepts only the supported state vocabulary', () => {
    assert.equal(isPetState('thinking'), true);
    assert.equal(isPetState('celebrate'), true);
    assert.equal(isPetState('running'), false);
    assert.equal(isPetState(null), false);
  });

  it('maps run lifecycle events to expressive pet states', () => {
    assert.equal(petStateForRunEvent({ type: 'accepted' }), 'thinking');
    assert.equal(petStateForRunEvent({ type: 'tool_start' }), 'working');
    assert.equal(petStateForRunEvent({ type: 'tool_end' }), 'thinking');
    assert.equal(petStateForRunEvent({ type: 'approval_required' }), 'attention');
    assert.equal(petStateForRunEvent({ type: 'approval_resolved', approved: true }), 'thinking');
    assert.equal(petStateForRunEvent({ type: 'approval_resolved', approved: false }), 'attention');
    assert.equal(petStateForRunEvent({ type: 'completed' }), 'celebrate');
    assert.equal(petStateForRunEvent({ type: 'failed' }), 'error');
    assert.equal(petStateForRunEvent({ type: 'cancelled' }), 'idle');
    assert.equal(petStateForRunEvent({ type: 'unknown' }), null);
  });

  it('promotes tool errors even when the tool end event is otherwise normal', () => {
    assert.equal(petStateForRunEvent({ type: 'tool_end', isError: true }), 'error');
    assert.equal(petStateForRunEvent({ type: 'delta', isError: true }), 'error');
  });

  it('keeps the highest-priority state across concurrent runs', () => {
    const coordinator = new PetStateCoordinator();
    assert.equal(coordinator.update({ type: 'accepted', runId: 'run-a', conversationId: 'conversation-a' }), 'thinking');
    assert.equal(coordinator.update({ type: 'tool_start', runId: 'run-b', conversationId: 'conversation-b' }), 'working');
    assert.equal(coordinator.update({ type: 'delta', runId: 'run-a' }), 'working');
    assert.deepEqual(coordinator.getFocusTarget(), { runId: 'run-b', conversationId: 'conversation-b' });
    assert.equal(coordinator.update({ type: 'approval_required', runId: 'run-a' }), 'attention');
    assert.deepEqual(coordinator.getFocusTarget(), { runId: 'run-a', conversationId: 'conversation-a' });
    assert.equal(coordinator.update({ type: 'completed', runId: 'run-b' }), 'celebrate');
  });

  it('builds concise feedback without exposing tool input or output', () => {
    assert.deepEqual(petFeedbackForRunEvent({ type: 'tool_start', runId: 'run-a', conversationId: 'conversation-a', toolName: 'browser_navigate' }, 'working'), {
      state: 'working',
      label: '正在使用工具',
      detail: '正在打开网页',
      conversationId: 'conversation-a',
      runId: 'run-a',
    });
    assert.equal(petFeedbackForRunEvent({ type: 'approval_required', runId: 'run-a' }, 'attention').label, '等待你的确认');
    assert.equal(petFeedbackForRunEvent({ type: 'completed', runId: 'run-a' }, 'celebrate').label, '任务完成');
  });

  it('describes browser interaction tools in user language', () => {
    assert.equal(petToolDisplayName('browser_click'), '正在操作网页');
  });

  it('describes screen observation tools in user language', () => {
    assert.equal(petToolDisplayName('observe_ui'), '正在查看屏幕');
  });

  it('uses stable user-facing copy for every Yuheng tool family', () => {
    const expected = {
      bash: '正在运行命令',
      read: '正在读取文件',
      write: '正在写入文件',
      edit: '正在编辑文件',
      browser_get_state: '正在读取网页',
      browser_screenshot: '正在截取网页',
      browser_type: '正在填写网页',
      browser_scroll: '正在浏览网页',
      browser_go_back: '正在返回上一页',
      browser_list_tabs: '正在查看标签页',
      browser_switch_tab: '正在切换标签页',
      browser_close_tab: '正在关闭标签页',
      find_roots: '正在查找窗口',
      search_ui: '正在搜索界面',
      expand_ui: '正在展开界面',
      inspect_ui: '正在检查控件',
      act_ui: '正在操作界面',
      read_text: '正在读取界面文字',
      wait_for: '正在等待界面变化',
      launch_browser: '正在启动浏览器',
      navigate_browser: '正在打开网页',
      evaluate_browser: '正在执行网页操作',
      task_list: '正在查看任务',
      task_create: '正在创建任务',
      task_update: '正在更新任务',
    } as const;

    for (const [toolName, displayName] of Object.entries(expected)) {
      assert.equal(petToolDisplayName(toolName), displayName, toolName);
    }
  });

  it('targets the completed assistant reply when the Pet is clicked', () => {
    const feedback = petFeedbackForRunEvent({
      type: 'completed',
      runId: 'run-a',
      conversationId: 'conversation-a',
      messageId: 'message-a',
    }, 'celebrate');

    assert.deepEqual(feedback.openTarget, {
      kind: 'conversation',
      conversationId: 'conversation-a',
      runId: 'run-a',
      messageId: 'message-a',
    });
  });

  it('targets the failed run record when the Pet is clicked', () => {
    const feedback = petFeedbackForRunEvent({
      type: 'failed',
      runId: 'run-a',
      conversationId: 'conversation-a',
    }, 'error');

    assert.deepEqual(feedback.openTarget, {
      kind: 'run',
      conversationId: 'conversation-a',
      runId: 'run-a',
    });
  });

  it('targets the pending approval when the Pet needs attention', () => {
    const feedback = petFeedbackForRunEvent({
      type: 'approval_required',
      runId: 'run-a',
      conversationId: 'conversation-a',
      approvalId: 'approval-a',
      toolName: 'browser_click',
    }, 'attention');

    assert.deepEqual(feedback.openTarget, {
      kind: 'approval',
      conversationId: 'conversation-a',
      runId: 'run-a',
      approvalId: 'approval-a',
    });
  });

  it('keeps only whitelisted fields in a conversation open target', () => {
    assert.deepEqual(parsePetOpenTarget({
      kind: 'conversation',
      conversationId: ' conversation-a ',
      runId: 'run-a',
      messageId: 'message-a',
      command: 'delete everything',
    }), {
      kind: 'conversation',
      conversationId: 'conversation-a',
      runId: 'run-a',
      messageId: 'message-a',
    });
  });

  it('preserves only a validated navigation target across the Pet feedback boundary', () => {
    assert.deepEqual(parsePetFeedback({
      state: 'celebrate',
      label: '任务完成',
      openTarget: {
        kind: 'conversation',
        conversationId: 'conversation-a',
        runId: 'run-a',
        messageId: 'message-a',
        command: 'delete everything',
      },
      input: 'secret prompt',
    }), {
      state: 'celebrate',
      label: '任务完成',
      openTarget: {
        kind: 'conversation',
        conversationId: 'conversation-a',
        runId: 'run-a',
        messageId: 'message-a',
      },
    });
    assert.deepEqual(parsePetFeedback({ state: 'celebrate', label: '任务完成', openTarget: { kind: 'run', conversationId: 'conversation-a' } }), {
      state: 'celebrate',
      label: '任务完成',
    });
  });

  it('accepts a complete run target and rejects one without a run id', () => {
    assert.deepEqual(parsePetOpenTarget({ kind: 'run', conversationId: 'conversation-a', runId: 'run-a' }), {
      kind: 'run',
      conversationId: 'conversation-a',
      runId: 'run-a',
    });
    assert.equal(parsePetOpenTarget({ kind: 'run', conversationId: 'conversation-a' }), undefined);
  });

  it('accepts only complete approval targets', () => {
    assert.deepEqual(parsePetOpenTarget({ kind: 'approval', conversationId: 'conversation-a', runId: 'run-a', approvalId: 'approval-a' }), {
      kind: 'approval',
      conversationId: 'conversation-a',
      runId: 'run-a',
      approvalId: 'approval-a',
    });
    assert.equal(parsePetOpenTarget({ kind: 'approval', conversationId: 'conversation-a', runId: 'run-a' }), undefined);
  });

  it('accepts a complete task target and rejects incomplete task targets', () => {
    assert.deepEqual(parsePetOpenTarget({ kind: 'task', boardId: 'board-a', taskId: 'task-a', command: 'ignore' }), {
      kind: 'task', boardId: 'board-a', taskId: 'task-a',
    });
    assert.equal(parsePetOpenTarget({ kind: 'task', boardId: 'board-a' }), undefined);
  });

  it('ignores stale events after a run reaches a terminal state', () => {
    const coordinator = new PetStateCoordinator();
    coordinator.update({ type: 'accepted', runId: 'run-a' }, 1_000);
    assert.equal(coordinator.update({ type: 'completed', runId: 'run-a' }, 1_100), 'celebrate');
    assert.equal(coordinator.update({ type: 'tool_start', runId: 'run-a' }, 1_200), 'celebrate');
    assert.equal(coordinator.update({ type: 'cancelled', runId: 'run-a' }, 1_300), 'celebrate');
    assert.equal(coordinator.expire(2_501), 'idle');
    assert.equal(coordinator.update({ type: 'delta', runId: 'run-a' }, 2_600), 'idle');
  });

  it('expires transient states and resumes the remaining run', () => {
    const coordinator = new PetStateCoordinator({ celebrateDurationMs: 1_000, errorDurationMs: 500 });
    coordinator.update({ type: 'tool_start', runId: 'run-a' }, 1_000);
    coordinator.update({ type: 'completed', runId: 'run-a' }, 1_100);
    coordinator.update({ type: 'tool_start', runId: 'run-b' }, 1_200);
    assert.equal(coordinator.expire(2_099), 'celebrate');
    assert.equal(coordinator.expire(2_101), 'working');
    coordinator.update({ type: 'failed', runId: 'run-b' }, 2_200);
    assert.equal(coordinator.expire(2_699), 'error');
    assert.equal(coordinator.expire(2_701), 'idle');
  });

  it('does not resurrect a cancelled run from a late event', () => {
    const coordinator = new PetStateCoordinator();
    coordinator.update({ type: 'tool_start', runId: 'run-a' }, 1_000);
    assert.equal(coordinator.update({ type: 'cancelled', runId: 'run-a' }, 1_100), 'idle');
    assert.equal(coordinator.update({ type: 'delta', runId: 'run-a' }, 1_200), 'idle');
  });
});
