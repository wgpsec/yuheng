export type SettingsSection =
  | 'provider'
  | 'capabilities'
  | 'appearance'
  | 'pet'
  | 'desktop'
  | 'backup'
  | 'about';

const settingsSections: readonly SettingsSection[] = [
  'provider',
  'capabilities',
  'appearance',
  'pet',
  'desktop',
  'backup',
  'about',
];

/** Normalize values crossing DOM/IPC boundaries before using them as state keys. */
export function normalizeSettingsSection(value: unknown): SettingsSection {
  return typeof value === 'string' && settingsSections.includes(value as SettingsSection)
    ? value as SettingsSection
    : 'provider';
}
