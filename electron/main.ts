import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import type { AppContext } from './app/app-context';
import {
  applicationVersionValue,
  configureRendererSecurity,
  initializeNormalApplication,
  prepareNormalApplicationShutdown,
  shouldKeepApplicationAliveWithoutWindows,
  waitForNormalApplicationShutdown,
} from './app/normal-application';
import { StartupCoordinator } from './app/startup-coordinator';
import type { StartupFailure } from './app/startup-result';
import { createStorageStartup, recordUnexpectedStartupFailure } from './app/storage-startup';
import { BROWSER_ARTIFACT_SCHEME } from './browser-artifacts';
import { NOTE_COVER_SCHEME } from './note-covers';
import { TASK_ASSET_SCHEME } from './task-assets';
import { RecoveryWindowLifecycle } from './windows/recovery-window';

protocol.registerSchemesAsPrivileged([
  { scheme: TASK_ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: BROWSER_ARTIFACT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: NOTE_COVER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let applicationContext: AppContext<{ primaryWindow: BrowserWindow }> | null = null;
let recoveryWindows: RecoveryWindowLifecycle;
let currentStartupFailure: StartupFailure | null = null;
let startupAttempt: Promise<'ready' | 'recovery_required'> | null = null;
let shutdownRequested = false;
let shutdownReady = false;

async function runStartupAttempt(): Promise<'ready' | 'recovery_required'> {
  if (startupAttempt) return startupAttempt;
  const operation = (async () => {
    const coordinator = new StartupCoordinator({
      database: createStorageStartup(app.getPath('userData'), applicationVersionValue),
      initialize: initializeNormalApplication,
      classifyUnexpectedFailure: (error, stage) => recordUnexpectedStartupFailure(
        app.getPath('userData'),
        applicationVersionValue,
        error,
        stage,
      ),
    });
    const result = await coordinator.start();
    if (result.status === 'ready') {
      applicationContext = result.context;
      currentStartupFailure = null;
      return 'ready' as const;
    }
    currentStartupFailure = result.failure;
    return 'recovery_required' as const;
  })();
  startupAttempt = operation;
  try {
    return await operation;
  } finally {
    if (startupAttempt === operation) startupAttempt = null;
  }
}

app.whenReady().then(async () => {
  configureRendererSecurity();
  recoveryWindows = new RecoveryWindowLifecycle({
    dataDirectory: app.getPath('userData'),
    logDirectory: app.getPath('logs'),
    documentsDirectory: app.getPath('documents'),
    preloadPath: path.join(__dirname, 'recovery-preload.js'),
    rendererHtmlPath: path.join(__dirname, '../dist-renderer/index.html'),
    developmentRendererUrl: process.env.ELECTRON_RENDERER_URL,
    getFailure: () => currentStartupFailure,
    retry: async () => {
      const status = await runStartupAttempt();
      return status === 'ready'
        ? { status }
        : { status, failure: currentStartupFailure! };
    },
    quit: () => app.quit(),
    onClosed: () => { if (!applicationContext) app.quit(); },
  });
  if (await runStartupAttempt() === 'recovery_required') recoveryWindows.show();
});

app.on('window-all-closed', () => {
  if (!shouldKeepApplicationAliveWithoutWindows()) app.quit();
});

app.on('before-quit', (event) => {
  prepareNormalApplicationShutdown();
  if (shutdownReady || !applicationContext) return;
  if (shutdownRequested) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  shutdownRequested = true;
  void waitForNormalApplicationShutdown(5_000).then(async (idle) => {
    // A timed-out Run may still be writing its terminal state. Keep the
    // database open in that case and let process exit reclaim the handle.
    if (idle) {
      await applicationContext?.close();
      applicationContext = null;
    }
    shutdownReady = true;
    app.quit();
  });
});
