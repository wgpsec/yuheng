export type RendererRole = 'main' | 'pet';

export class IpcSenderAuthorizer {
  private readonly roles = new Map<number, RendererRole>();

  register(senderId: number, role: RendererRole): void {
    this.roles.set(senderId, role);
  }

  unregister(senderId: number): void {
    this.roles.delete(senderId);
  }

  roleOf(senderId: number): RendererRole | undefined {
    return this.roles.get(senderId);
  }

  assertAllowed(senderId: number, allowed: readonly RendererRole[]): RendererRole {
    const role = this.roles.get(senderId);
    if (!role) throw new Error('IPC sender is not registered.');
    if (!allowed.includes(role)) throw new Error(`IPC sender role ${role} is not allowed for this operation.`);
    return role;
  }
}
