import { readFileSync } from 'node:fs';
import path from 'node:path';

export function applicationVersion(appRoot: string): string {
  const manifest: unknown = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || typeof (manifest as { version?: unknown }).version !== 'string') {
    throw new Error('Application package.json must define a version.');
  }
  return (manifest as { version: string }).version;
}
