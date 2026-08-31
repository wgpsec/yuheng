import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CODEX_PET_ANIMATIONS, nextCodexPetFrame } from '../frontend/src/production/pet-animation';
import { INITIAL_PET_FEEDBACK_PRESENTATION, presentPetFeedback, resolvePetFeedback } from '../frontend/src/production/pet-feedback-presentation';
import { taskReminderFeedback } from '../electron/task-pet-reminders';

describe('Desktop pet dragging', () => {
  it('hides routine working feedback in important-only mode', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'important' },
      { state: 'working', label: '正在执行' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('hides routine thinking feedback in important-only mode', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'important' },
      { state: 'thinking', label: '正在思考' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('hides idle feedback in important-only mode', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'important' },
      { state: 'idle', label: '已就绪' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('hides completion feedback when completion prompts are disabled', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'all', completionFeedback: false },
      { state: 'celebrate', label: '任务完成' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('hides error feedback when error prompts are disabled', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'all', errorFeedback: false },
      { state: 'error', label: '执行失败' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('hides approval feedback when approval prompts are disabled', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'all', approvalFeedback: false },
      { state: 'attention', label: '等待你的确认' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('keeps task reminders visible when approval prompts are disabled', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'all', approvalFeedback: false },
      taskReminderFeedback({ id: 'task-1', boardId: 'board-1', title: '今日任务' }),
      1_000,
    ), { showBubble: true, playSound: false });
  });

  it('hides every bubble in hidden feedback mode', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'hidden' },
      { state: 'error', label: '执行失败' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('does not play sound in hidden feedback mode', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'hidden', soundEnabled: true },
      { state: 'celebrate', label: '任务完成' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('suppresses feedback during a temporary focus period', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'all', mutedUntil: 2_000 },
      { state: 'attention', label: '等待你的确认' },
      1_000,
    ), { showBubble: false, playSound: false });
  });

  it('allows completion sound only after sound is enabled', () => {
    assert.deepEqual(resolvePetFeedback(
      { enabled: true, feedbackMode: 'all', soundEnabled: true },
      { state: 'celebrate', label: '任务完成' },
      1_000,
    ), { showBubble: true, playSound: true });
  });

  it('shows ready only for the initial idle state, not after a completed run expires', () => {
    const initialReady = presentPetFeedback(INITIAL_PET_FEEDBACK_PRESENTATION, { state: 'idle', label: '已就绪' });
    assert.equal(initialReady.feedback?.label, '已就绪');
    const completed = presentPetFeedback(initialReady, { state: 'celebrate', label: '任务完成', conversationId: 'conversation-a' });
    assert.equal(completed.feedback?.label, '任务完成');
    const expired = presentPetFeedback(completed, { state: 'idle', label: '已就绪' });
    assert.equal(expired.feedback, null);
  });

  it('coalesces rapid routine feedback from the same run', () => {
    const first = presentPetFeedback(INITIAL_PET_FEEDBACK_PRESENTATION, {
      state: 'working', label: '正在使用工具', detail: '正在读取文件', runId: 'run-a',
    }, 1_000);
    const coalesced = presentPetFeedback(first, {
      state: 'working', label: '正在使用工具', detail: '正在打开网页', runId: 'run-a',
    }, 1_250);

    assert.equal(coalesced.feedback?.detail, '正在读取文件');
  });

  it('coalesces rapid working-to-thinking transitions from the same run', () => {
    const first = presentPetFeedback(INITIAL_PET_FEEDBACK_PRESENTATION, {
      state: 'working', label: '正在使用工具', detail: '正在读取文件', runId: 'run-a',
    }, 1_000);
    const coalesced = presentPetFeedback(first, {
      state: 'thinking', label: '正在整理结果', detail: '正在读取文件', runId: 'run-a',
    }, 1_250);

    assert.equal(coalesced.feedback?.state, 'working');
  });

  it('uses explicit pointer drag IPC instead of relying on a CSS drag region', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/pet-preload.ts', import.meta.url), 'utf8');
    const petIpc = readFileSync(new URL('../electron/ipc/register-pet-ipc.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(renderer, /onPointerDown=\{startDrag\}/);
    assert.match(renderer, /onPointerMove=\{moveDrag\}/);
    assert.match(renderer, /suppressClickRef/);
    assert.match(renderer, /if \(!drag\.moved\) \{ suppressClickRef\.current = true; void bridge\?\.pet\.focusMain\(visibleFeedback\?\.openTarget\); \}/);
    assert.match(renderer, /onClick=\{handleClick\}/);
    assert.match(renderer, /focusMain\(visibleFeedback\?\.openTarget\)/);
    assert.match(preload, /beginDrag: .*pet:drag-start/);
    assert.match(preload, /dragTo: .*pet:drag-move/);
    assert.match(petIpc, /registrar\.onPet\('pet:drag-start'/);
    assert.match(petIpc, /registrar\.onPet\('pet:drag-move'/);
    assert.match(css, /\.desktop-pet\s*\{[^}]*-webkit-app-region:\s*no-drag/);
  });

  it('runs the pet in a sandbox with a pet-only preload surface', () => {
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    const petWindow = readFileSync(new URL('../electron/windows/pet-window.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/pet-preload.ts', import.meta.url), 'utf8');
    assert.match(main, /preloadPath: path\.join\(__dirname, '\.\.\/pet-preload\.js'\)/);
    assert.match(petWindow, /webPreferences: \{[\s\S]*?preload: this\.options\.preloadPath[\s\S]*?sandbox: true/);
    assert.match(petWindow, /this\.options\.registerRenderer\(window\);\s*window\.webContents\.on\('will-navigate'/);
    assert.match(petWindow, /window\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
    assert.match(preload, /contextBridge\.exposeInMainWorld\('desktopBridge', \{\s*pet:/);
    assert.doesNotMatch(preload, /\b(?:provider|conversations|notes|tasks|runs|backup):\s*\{/);
  });

  it('advances Codex Pet sprites by one complete 192px frame', () => {
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.deepEqual(Object.fromEntries(Object.entries(CODEX_PET_ANIMATIONS).map(([state, animation]) => [state, animation.durations.length])), { idle: 6, working: 6, celebrate: 4 });
    for (const state of ['idle', 'working', 'celebrate'] as const) {
      let frame = 0;
      for (let index = 0; index < 100; index += 1) {
        assert.ok(frame >= 0 && frame < CODEX_PET_ANIMATIONS[state].durations.length);
        frame = nextCodexPetFrame(state, frame);
      }
    }
    assert.match(css, /\.desktop-pet-sprite\s*\{[^}]*animation:\s*none/);
  });

  it('uses custom manifest frame counts when advancing a sprite', () => {
    const overrides = { thinking: { row: 6, durations: [20, 30] } };
    assert.equal(nextCodexPetFrame('thinking', 0, overrides), 1);
    assert.equal(nextCodexPetFrame('thinking', 1, overrides), 0);
  });

  it('pauses renderer animation while the isolated window is hidden', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(renderer, /document\.visibilityState/);
    assert.match(renderer, /!codexPet \|\| !isDocumentVisible/);
    assert.match(css, /\.desktop-pet-paused \* \{[^}]*animation-play-state:\s*paused/);
  });

  it('stops sprite timers when the system requests reduced motion', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    assert.match(renderer, /if \(!codexPet \|\| !isDocumentVisible \|\| reducedMotion\) return undefined/);
    assert.match(renderer, /idleAnimationDelay/);
  });

  it('exposes state controls and protects locked drag at both IPC boundaries', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    const petWindow = readFileSync(new URL('../electron/windows/pet-window.ts', import.meta.url), 'utf8');
    const mainWindow = readFileSync(new URL('../electron/windows/main-window.ts', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../frontend/src/production/ProductionRenderer.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /if \(petLocked\) return;/);
    assert.match(petWindow, /this\.options\.getConfig\(\)\.locked === true/);
    assert.match(petWindow, /context-menu/);
    assert.match(settings, /锁定位置/);
    assert.match(settings, /不透明度/);
    assert.match(settings, /始终置顶/);
    assert.match(settings, /边缘吸附/);
    assert.match(settings, /轻微惯性/);
    assert.match(settings, /边界回弹/);
    assert.match(petWindow, /display-removed/);
    assert.match(mainWindow, /this\.options\.onFullScreenChange\(true\)/);
  });

  it('exposes persistent anti-interruption controls in pet settings', () => {
    const settings = readFileSync(new URL('../frontend/src/production/ProductionRenderer.tsx', import.meta.url), 'utf8');
    assert.match(settings, /重要状态/);
    assert.match(settings, /全部状态/);
    assert.match(settings, /隐藏气泡/);
    assert.match(settings, /完成提示/);
    assert.match(settings, /错误提示/);
    assert.match(settings, /审批提示/);
    assert.match(settings, /提示音/);
    assert.match(settings, /专注 30 分钟/);
  });

  it('routes feedback preferences through the isolated pet bridge', () => {
    const preload = readFileSync(new URL('../electron/pet-preload.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    assert.match(main, /input\.feedbackMode === 'important'/);
    assert.match(main, /soundEnabled/);
    assert.match(main, /mutedUntil/);
    assert.match(preload, /DesktopPetConfig/);
  });

  it('applies feedback policy before creating pet bubble timers', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /resolvePetFeedback\(petConfigRef\.current, next, now\)/);
    assert.match(renderer, /if \(!decision\.showBubble\)/);
  });

  it('creates feedback audio only when policy allows it and the pet is visible', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /if \(decision\.playSound && document\.visibilityState === 'visible'\) playPetFeedbackSound\(next\.state\)/);
  });

  it('coordinates run states in the main process instead of letting events overwrite each other', () => {
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    assert.match(main, /new PetStateCoordinator/);
    assert.match(main, /petStateCoordinator\.update\(event\)/);
    assert.match(main, /schedulePetStateExpiry\(\)/);
    assert.match(main, /if \(petStateCoordinator\.getState\(\) === 'idle'\) showNextTaskPetReminder\(\)/);
  });

  it('shows run feedback and opens the represented conversation when clicked', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    const production = readFileSync(new URL('../frontend/src/production/ProductionRenderer.tsx', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const petPreload = readFileSync(new URL('../electron/pet-preload.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(renderer, /bridge\.pet\.onFeedback/);
    assert.match(renderer, /desktop-pet-feedback/);
    assert.match(renderer, /focusMain\(visibleFeedback\?\.openTarget\)/);
    assert.match(preload, /pet:open-target/);
    assert.match(preload, /openTarget/);
    assert.match(petPreload, /parsePetFeedback/);
    assert.match(main, /focusMainWindowForPet/);
    assert.match(main, /store\.getConversation\(target\.conversationId\)/);
    assert.match(production, /if \(!activeBridge \|\| !workspaceLoaded\) return;/);
    assert.match(production, /activeBridge\.pet\.onOpenTarget\(openTarget\)/);
    assert.match(production, /activeBridge\.pet\.takeOpenTarget\(\)/);
    assert.match(css, /\.desktop-pet-feedback\s*\{/);
  });

  it('connects task reminders and Pet task shortcuts to task navigation', () => {
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    const petWindow = readFileSync(new URL('../electron/windows/pet-window.ts', import.meta.url), 'utf8');
    const taskWorkspace = readFileSync(new URL('../frontend/src/features/tasks/use-task-workspace.ts', import.meta.url), 'utf8');
    const taskBoard = readFileSync(new URL('../frontend/src/features/tasks/task-board.tsx', import.meta.url), 'utf8');
    assert.match(main, /enqueueTaskPetReminder\(task\)/);
    assert.match(petWindow, /label: '今日任务'/);
    assert.match(petWindow, /label: '快速记录'/);
    assert.match(taskWorkspace, /event\.type === 'open_today' \|\| event\.type === 'quick_record'/);
    assert.match(taskBoard, /setFilter\('today'\)/);
    assert.match(taskBoard, /openNew\(taskTypes\[0\]\.id\)/);
  });

  it('exposes skin diagnostics and managed lifecycle actions only to the main renderer', () => {
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const petPreload = readFileSync(new URL('../electron/pet-preload.ts', import.meta.url), 'utf8');
    const petIpc = readFileSync(new URL('../electron/ipc/register-pet-ipc.ts', import.meta.url), 'utf8');
    assert.match(preload, /catalog: \(\) => ipcRenderer\.invoke\('pet:catalog'\)/);
    assert.match(preload, /import: \(\) => ipcRenderer\.invoke\('pet:import'\)/);
    assert.match(preload, /delete: \(petId: string\) => ipcRenderer\.invoke\('pet:delete', petId\)/);
    assert.match(preload, /reveal: \(petId: string\) => ipcRenderer\.invoke\('pet:reveal', petId\)/);
    assert.doesNotMatch(petPreload, /pet:catalog|pet:import|pet:delete|pet:reveal/);
    assert.match(petIpc, /registrar\.main\('pet:catalog'/);
    assert.match(petIpc, /registrar\.main\('pet:import'/);
    assert.match(petIpc, /registrar\.main\('pet:delete'/);
    assert.match(petIpc, /registrar\.main\('pet:reveal'/);
  });

  it('renders state-aware skin previews and compatibility guidance in settings', () => {
    const settings = readFileSync(new URL('../frontend/src/production/ProductionRenderer.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(settings, /PetSkinPreview/);
    assert.match(settings, /回退到玉衡默认动画/);
    assert.match(settings, /动画预览/);
    assert.match(settings, /不可选择/);
    assert.match(settings, /导入皮肤/);
    assert.match(settings, /pet\.delete/);
    assert.match(settings, /pet\.reveal/);
    assert.match(css, /\.pet-preview-panel/);
    assert.match(css, /\.pet-compatibility-status/);
  });
});
