import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, BrowserUseConfig, ComputerUseConfig, DesktopBridge, ProviderConfig } from '../../contracts/desktop-bridge';
import { normalizeSettingsSection, type SettingsSection } from '../../production/settings-section';

export type ThemeName = 'dark' | 'light' | 'graphite' | 'notion';

export function useSettingsController(bridge: DesktopBridge | undefined) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [browserUse, setBrowserUse] = useState<BrowserUseConfig>({ enabled: false });
  const [computerUse, setComputerUse] = useState<ComputerUseConfig>({ enabled: false });
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('yuheng-theme') : null;
    return saved === 'light' || saved === 'graphite' || saved === 'notion' ? saved : 'dark';
  });
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [initialSection, setInitialSection] = useState<SettingsSection>('provider');
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const closingRef = useRef(false);
  mountedRef.current = mounted;
  closingRef.current = closing;

  const open = useCallback((section?: unknown) => {
    setInitialSection(normalizeSettingsSection(section));
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    mountedRef.current = true; closingRef.current = false;
    setMounted(true); setClosing(false);
  }, []);
  const close = useCallback(() => {
    if (!mountedRef.current || closingRef.current) return;
    closingRef.current = true; setClosing(true);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false); setClosing(false); mountedRef.current = false; closingRef.current = false; closeTimerRef.current = null;
    }, 190);
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    void Promise.all([bridge.app.getInfo(), bridge.provider.get(), bridge.provider.list(), bridge.browserUse.get(), bridge.computerUse.get()]).then(([info, configuredProvider, configuredProviders, configuredBrowserUse, configuredComputerUse]) => {
      if (disposed) return;
      setAppInfo(info); setProvider(configuredProvider); setProviders(configuredProviders); setBrowserUse(configuredBrowserUse); setComputerUse(configuredComputerUse);
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : '加载设置失败。'); });
    return () => { disposed = true; };
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    return bridge.pet.onOpenSettings((section) => open(section));
  }, [bridge, open]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (typeof localStorage !== 'undefined') localStorage.setItem('yuheng-theme', theme);
  }, [theme]);
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);

  return { appInfo, provider, setProvider, providers, setProviders, browserUse, setBrowserUse, computerUse, setComputerUse, theme, setTheme, mounted, closing, initialSection, open, close, error, clearError: () => setError(null) };
}
