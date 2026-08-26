/// <reference types="vite/client" />

interface Window {
  desktopBridge: import('./src/contracts/desktop-bridge').DesktopBridge;
}
