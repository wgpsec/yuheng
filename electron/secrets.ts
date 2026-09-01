import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

type PortableSecrets = { version: 2; providerKeys: Record<string, string> };
type LegacySecrets = { providerKey?: string; providerKeys?: Record<string, string> };

export class SecretStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'secrets.json');
  }

  getProviderKey(providerId = 'default'): string | null {
    const portable = this.readPortable();
    if (portable) return portable[providerId] ?? null;
    return this.readLegacyKey(providerId);
  }

  hasProviderKey(providerId = 'default'): boolean {
    return Boolean(this.getProviderKey(providerId));
  }

  exportProviderKeys(): Record<string, string> {
    const keys: Record<string, string> = {};
    for (const providerId of this.providerIds()) {
      const key = this.getProviderKey(providerId);
      if (key) keys[providerId] = key;
    }
    return keys;
  }

  private providerIds(): string[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as LegacySecrets & Partial<PortableSecrets>;
      if (raw.version === 2) return Object.keys(raw.providerKeys ?? {}).filter((id) => /^[A-Za-z0-9._:-]{1,200}$/.test(id));
      return [...new Set(['default', ...Object.keys(raw.providerKeys ?? {})])];
    } catch { return []; }
  }

  saveProviderKeys(keys: Record<string, string>): void {
    for (const [providerId, key] of Object.entries(keys)) {
      if (typeof providerId === 'string' && providerId.trim() && typeof key === 'string' && key.trim()) this.saveProviderKey(providerId, key);
    }
  }

  saveProviderKey(providerId: string, key: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const providerKeys = this.readAllKeys();
    this.write({ version: 2, providerKeys: { ...providerKeys, [providerId]: key } });
  }

  deleteProviderKey(providerId: string): void {
    if (!fs.existsSync(this.filePath)) return;
    const providerKeys = this.readAllKeys();
    delete providerKeys[providerId];
    this.write({ version: 2, providerKeys });
  }

  private readPortable(): Record<string, string> | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<PortableSecrets>;
      if (raw.version !== 2 || !raw.providerKeys || typeof raw.providerKeys !== 'object' || Array.isArray(raw.providerKeys)) return null;
      return Object.fromEntries(Object.entries(raw.providerKeys).filter(([id, key]) => /^[A-Za-z0-9._:-]{1,200}$/.test(id) && typeof key === 'string' && key.length <= 1000));
    } catch { return null; }
  }

  private readLegacyKey(providerId: string): string | null {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as LegacySecrets;
      const encoded = raw.providerKeys?.[providerId] ?? (providerId === 'default' ? raw.providerKey : undefined);
      return encoded ? safeStorage.decryptString(Buffer.from(encoded, 'base64')) : null;
    } catch { return null; }
  }

  private readAllKeys(): Record<string, string> {
    const portable = this.readPortable();
    if (portable) return portable;
    const keys: Record<string, string> = {};
    for (const providerId of this.providerIds()) {
      const key = this.readLegacyKey(providerId);
      if (key) keys[providerId] = key;
    }
    return keys;
  }

  private write(value: PortableSecrets): void {
    fs.writeFileSync(this.filePath, JSON.stringify(value), { mode: 0o600 });
    fs.chmodSync(this.filePath, 0o600);
  }
}
