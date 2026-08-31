import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IpcSenderAuthorizer, type RendererRole } from '../ipc-security';

export type IpcHandler<Args extends unknown[] = unknown[], Result = unknown> = (
  event: IpcMainInvokeEvent,
  ...args: Args
) => Result | Promise<Result>;

export interface DomainIpcRegistrar {
  main<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void;
  mainAndPet<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void;
  pet<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void;
  onPet<Args extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: Args) => void): void;
}

export class SecuredIpcRegistrar implements DomainIpcRegistrar {
  private readonly channels = new Set<string>();
  private readonly listeners = new Map<string, (event: IpcMainEvent, ...args: any[]) => void>();
  private disposed = false;

  constructor(
    private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'>,
    private readonly authorizer: IpcSenderAuthorizer,
    private readonly onRendererDestroyed: (senderId: number) => void = () => {},
  ) {}

  registerRenderer(window: BrowserWindow, role: RendererRole): void {
    if (this.disposed) throw new Error('Cannot register a renderer after IPC disposal.');
    const senderId = window.webContents.id;
    this.authorizer.register(senderId, role);
    window.webContents.once('destroyed', () => {
      this.authorizer.unregister(senderId);
      this.onRendererDestroyed(senderId);
    });
  }

  main<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void {
    this.forRoles(channel, ['main'], handler);
  }

  mainAndPet<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void {
    this.forRoles(channel, ['main', 'pet'], handler);
  }

  pet<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void {
    this.forRoles(channel, ['pet'], handler);
  }

  onPet<Args extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: Args) => void): void {
    if (this.disposed) throw new Error('Cannot register IPC after disposal.');
    if (this.listeners.has(channel)) throw new Error(`IPC listener is already registered: ${channel}`);
    const securedListener = (event: IpcMainEvent, ...args: any[]) => {
      this.authorizer.assertAllowed(event.sender.id, ['pet']);
      listener(event, ...args as Args);
    };
    this.ipc.on(channel, securedListener);
    this.listeners.set(channel, securedListener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const channel of this.channels) this.ipc.removeHandler(channel);
    this.channels.clear();
    for (const [channel, listener] of this.listeners) this.ipc.removeListener(channel, listener);
    this.listeners.clear();
  }

  registeredChannels(): readonly string[] {
    return [...this.channels, ...this.listeners.keys()];
  }

  private forRoles<Args extends unknown[], Result>(
    channel: string,
    roles: readonly RendererRole[],
    handler: IpcHandler<Args, Result>,
  ): void {
    if (this.disposed) throw new Error('Cannot register IPC after disposal.');
    if (this.channels.has(channel)) throw new Error(`IPC channel is already registered: ${channel}`);
    this.ipc.handle(channel, (event, ...args: Args) => {
      this.authorizer.assertAllowed(event.sender.id, roles);
      return handler(event, ...args);
    });
    this.channels.add(channel);
  }
}
