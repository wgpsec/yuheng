import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const dependency = packageJson.dependencies?.['@injaneity/pi-computer-use'];
const shaMatch = typeof dependency === 'string' ? dependency.match(/#([0-9a-f]{40})$/i) : null;
if (!shaMatch) throw new Error('Computer Use dependency must end with a complete 40-character commit SHA.');

const expectedSha = shaMatch[1].toLowerCase();
const rootDependency = packageLock.packages?.['']?.dependencies?.['@injaneity/pi-computer-use'];
const resolved = packageLock.packages?.['node_modules/@injaneity/pi-computer-use']?.resolved;
const lockRefs = [rootDependency, resolved].filter((value) => typeof value === 'string');
if (lockRefs.length !== 2 || lockRefs.some((value) => !value.toLowerCase().endsWith(`#${expectedSha}`))) {
  throw new Error(`package.json and package-lock.json must pin the same Computer Use commit (${expectedSha}).`);
}

const installedDir = path.join(root, 'node_modules/@injaneity/pi-computer-use');
if (fs.existsSync(path.join(installedDir, '.git'))) {
  const installedSha = execFileSync('git', ['-C', installedDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  if (installedSha !== expectedSha) throw new Error(`Installed Computer Use commit is ${installedSha}, expected ${expectedSha}. Reinstall dependencies before building.`);
}
console.log(`Computer Use dependency pinned to ${expectedSha}.`);
