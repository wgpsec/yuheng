import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let backendPath;
try {
  backendPath = require.resolve('@injaneity/pi-computer-use/src/platform/macos/backend.ts');
} catch {
  // Dependencies may not be installed yet (for example during a partial npm install).
  process.exit(0);
}

const source = fs.readFileSync(backendPath, 'utf8');
const broken = 'windowId: request.target.windowId,';
const fixed = '...(request.target.windowId > 0 ? { windowId: request.target.windowId } : {}),';
if (source.includes(fixed) || !source.includes(broken)) process.exit(0);
fs.writeFileSync(backendPath, source.replace(broken, fixed));
console.log('Applied local pi-computer-use window target compatibility patch.');
