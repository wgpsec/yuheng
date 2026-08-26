import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

export class SecretStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'secrets.json');
  }

  getProviderKey(): string | null {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { providerKey?: string };
      if (!raw.providerKey || !safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(raw.providerKey, 'base64'));
    } catch {
      return null;
    }
  }

  hasProviderKey(): boolean {
    return Boolean(this.getProviderKey());
  }

  saveProviderKey(key: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable.');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(key).toString('base64');
    fs.writeFileSync(this.filePath, JSON.stringify({ providerKey: encrypted }), { mode: 0o600 });
  }
}
