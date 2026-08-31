/// <reference types="vite/client" />

interface Window {
  desktopBridge: import('./src/contracts/desktop-bridge').DesktopBridge;
  /** Provided by the recovery preload when the app is launched in recovery mode. */
  recoveryBridge?: import('./src/contracts/desktop-bridge').RecoveryBridge;
}
