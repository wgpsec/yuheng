import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

export class SecretStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'secrets.json');
  }

  getProviderKey(providerId = 'default'): string | null {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { providerKey?: string; providerKeys?: Record<string, string> };
      const encoded = raw.providerKeys?.[providerId] ?? (providerId === 'default' ? raw.providerKey : undefined);
      if (!encoded || !safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      return null;
    }
  }

  hasProviderKey(providerId = 'default'): boolean {
    return Boolean(this.getProviderKey(providerId));
  }

  saveProviderKey(providerId: string, key: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable.');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    let providerKeys: Record<string, string> = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { providerKey?: string; providerKeys?: Record<string, string> };
      providerKeys = { ...(raw.providerKeys ?? {}), ...(raw.providerKey ? { default: raw.providerKey } : {}) };
    } catch { /* first provider */ }
    providerKeys[providerId] = safeStorage.encryptString(key).toString('base64');
    fs.writeFileSync(this.filePath, JSON.stringify({ providerKeys }), { mode: 0o600 });
  }

  deleteProviderKey(providerId: string): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { providerKey?: string; providerKeys?: Record<string, string> };
      const providerKeys = { ...(raw.providerKeys ?? {}) };
      delete providerKeys[providerId];
      const legacyProviderKey = providerId === 'default' ? undefined : raw.providerKey;
      fs.writeFileSync(this.filePath, JSON.stringify({ ...(legacyProviderKey ? { providerKey: legacyProviderKey } : {}), providerKeys }), { mode: 0o600 });
    } catch { /* unreadable secrets are treated as absent */ }
  }
}
