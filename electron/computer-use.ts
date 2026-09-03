import type { ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const COMPUTER_USE_VERSION = '0.5.0';
const execFileAsync = promisify(execFile);
const COMPUTER_USE_INSTALL_COMMAND = '内置 helper，无需单独下载；点击“安装或修复”完成安装。';
export const COMPUTER_USE_TOOL_NAMES = [
  'find_roots',
  'observe_ui',
  'search_ui',
  'expand_ui',
  'inspect_ui',
  'act_ui',
  'read_text',
  'wait_for',
  'launch_browser',
  'navigate_browser',
  'evaluate_browser',
] as const;

export type ComputerUseToolName = typeof COMPUTER_USE_TOOL_NAMES[number];
export type ComputerUseEnvironment = {
  status: 'ready' | 'unavailable' | 'needs_permission';
  platform: string;
  arch: string;
  macOS: string | null;
  helperPath: string | null;
  helperInstalled: boolean;
  permissions: 'granted' | 'required' | 'unknown';
  accessibility: boolean | null;
  screenRecording: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  permissionTarget: string | null;
  message: string;
  installCommand: string;
};

export type ComputerUsePermissionKind = 'accessibility' | 'screenRecording';
type ScreenRecordingStatus = ComputerUseEnvironment['screenRecording'];

function electronSystemPreferences(): { isTrustedAccessibilityClient?: (prompt: boolean) => boolean; getMediaAccessStatus?: (mediaType: 'screen') => ScreenRecordingStatus } | null {
  try {
    return require('electron').systemPreferences ?? null;
  } catch {
    return null;
  }
}

export function computerUseHelperPath(homeDir = os.homedir(), fileExists: (filePath: string) => boolean = fs.existsSync): string | null {
  const configured = process.env.PI_COMPUTER_USE_HELPER_APP_PATH?.trim();
  const candidates = configured ? [configured] : [path.join('/Applications', 'pi-computer-use.app'), path.join(homeDir, 'Applications', 'pi-computer-use.app')];
  return candidates.find((candidate) => fileExists(candidate)) ?? candidates[0] ?? null;
}

export async function diagnoseComputerUseEnvironment(options: {
  platform?: NodeJS.Platform;
  arch?: string;
  homeDir?: string;
  fileExists?: (filePath: string) => boolean;
  exec?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  accessibilityCheck?: () => boolean;
  screenRecordingCheck?: () => ScreenRecordingStatus;
} = {}): Promise<ComputerUseEnvironment> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const run = options.exec ?? (async (command, args) => execFileAsync(command, args, { timeout: 4_000 }));
  let macOS: string | null = null;
  if (platform === 'darwin') {
    try { macOS = (await run('sw_vers', ['-productVersion'])).stdout.trim() || null; } catch { macOS = null; }
  }
  const helperPath = platform === 'darwin' ? computerUseHelperPath(options.homeDir, options.fileExists ?? fs.existsSync) : null;
  const helperInstalled = Boolean(helperPath && (options.fileExists ?? fs.existsSync)(helperPath));
  const base = { platform, arch, macOS, helperPath, helperInstalled, installCommand: COMPUTER_USE_INSTALL_COMMAND };
  if (platform !== 'darwin') return { ...base, status: 'unavailable', permissions: 'unknown', accessibility: null, screenRecording: 'unknown', permissionTarget: null, message: 'Computer Use 当前仅支持 macOS。' };
  if (arch !== 'arm64') return { ...base, status: 'unavailable', permissions: 'unknown', accessibility: null, screenRecording: 'unknown', permissionTarget: null, message: '当前安装包仅支持 Apple Silicon（arm64）Mac。' };
  if (!helperInstalled) return { ...base, status: 'unavailable', permissions: 'unknown', accessibility: null, screenRecording: 'unknown', permissionTarget: helperPath, message: '未安装 Computer Use helper。点击“安装或修复”，然后在系统设置中授予辅助功能和屏幕录制权限。' };

  const preferences = electronSystemPreferences();
  const accessibility = options.accessibilityCheck?.() ?? (preferences?.isTrustedAccessibilityClient ? preferences.isTrustedAccessibilityClient(false) : null);
  const screenRecording = options.screenRecordingCheck?.() ?? (preferences?.getMediaAccessStatus ? preferences.getMediaAccessStatus('screen') : 'unknown');
  const permissions = accessibility === true && screenRecording === 'granted' ? 'granted' : accessibility === null || screenRecording === 'unknown' ? 'unknown' : 'required';
  const status = permissions === 'granted' ? 'ready' : 'needs_permission';
  const message = status === 'ready'
    ? 'Computer Use 已就绪，辅助功能和屏幕录制均已授权。'
    : permissions === 'unknown'
      ? '无法读取 macOS 权限状态，请点击“授权”打开系统设置，然后重新检查。'
      : `缺少 macOS 权限：${accessibility === true ? '' : '辅助功能'}${accessibility !== true && screenRecording !== 'granted' ? '、' : ''}${screenRecording === 'granted' ? '' : '屏幕录制'}。`;
  return { ...base, status, permissions, accessibility, screenRecording, permissionTarget: helperPath, message };
}

export async function openComputerUsePermissionPane(kind: ComputerUsePermissionKind, options: {
  platform?: NodeJS.Platform;
  exec?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  requestAccessibility?: (prompt: boolean) => boolean;
} = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') throw new Error('macOS 权限设置仅适用于 macOS。');
  if (kind !== 'accessibility' && kind !== 'screenRecording') throw new Error('未知的 Computer Use 权限类型。');
  if (kind === 'accessibility') {
    const preferences = electronSystemPreferences();
    if (options.requestAccessibility) options.requestAccessibility(true);
    else preferences?.isTrustedAccessibilityClient?.(true);
  }
  const run = options.exec ?? (async (command, args) => execFileAsync(command, args, { timeout: 4_000 }));
  const pane = kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
  await run('open', [`x-apple.systempreferences:com.apple.preference.security?${pane}`]);
}

export async function installComputerUseHelper(options: { exec?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }> } = {}): Promise<void> {
  const script = require.resolve('@injaneity/pi-computer-use/scripts/setup-helper.mjs');
  if (options.exec) {
    await options.exec(process.execPath, [script, '--runtime']);
    return;
  }
  await execFileAsync(process.execPath, [script, '--runtime'], {
    timeout: 120_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BUN_BE_BUN: '1' },
  });
}
export type ComputerUseApproval = (toolCallId: string, toolName: ComputerUseToolName, args: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>;

export function computerUseExtensionPath(): string {
  return require.resolve('@injaneity/pi-computer-use/extensions/computer-use.ts');
}

export function redactComputerUseToolInput(toolName: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  if (toolName === 'act_ui' && Array.isArray(input.actions)) {
    return {
      ...input,
      actions: input.actions.map((action) => {
        if (!action || typeof action !== 'object') return action;
        const item = action as Record<string, unknown>;
        if (typeof item.text !== 'string') return item;
        return { ...item, text: `<redacted:${item.text.length} characters>` };
      }),
    };
  }
  return toolName === 'evaluate_browser' && typeof input.expression === 'string'
    ? { ...input, expression: `<redacted:${input.expression.length} characters>` }
    : value;
}

function approvalRequired(toolName: ComputerUseToolName): boolean {
  return toolName === 'act_ui' || toolName === 'launch_browser' || toolName === 'navigate_browser' || toolName === 'evaluate_browser';
}

/** Adds host-owned approval without modifying the upstream extension. */
export function createComputerUseApprovalExtension(requestApproval: ComputerUseApproval): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event: ToolCallEvent, ctx) => {
      if (!COMPUTER_USE_TOOL_NAMES.includes(event.toolName as ComputerUseToolName)) return undefined;
      const toolName = event.toolName as ComputerUseToolName;
      if (!approvalRequired(toolName)) return undefined;
      const approved = await requestApproval(event.toolCallId, toolName, event.input, ctx.signal);
      return approved ? undefined : { block: true, reason: '用户拒绝了这次 Computer Use 操作。', terminate: true };
    });
  };
}

/** Serializes sessions because pi-computer-use owns process-global native state. */
export class ComputerUseLease {
  private tail: Promise<void> = Promise.resolve();

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DOMException('Computer Use wait cancelled.', 'AbortError');
    let releasePrevious!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { releasePrevious = resolve; });
    try {
      await this.waitFor(previous, signal);
    } catch (error) {
      releasePrevious();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releasePrevious();
    };
  }

  private async waitFor(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return previous;
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException('Computer Use wait cancelled.', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        previous.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => undefined);
      }),
    ]);
  }
}
