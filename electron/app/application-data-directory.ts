import path from 'node:path';

export type ApplicationDataProfile = 'development' | 'production';

export function resolveApplicationDataProfile(isPackaged: boolean, requestedProfile?: string): ApplicationDataProfile {
  if (isPackaged) return 'production';
  if (!requestedProfile) return 'development';
  if (requestedProfile === 'development' || requestedProfile === 'production') return requestedProfile;
  throw new Error('YUHENG_DATA_PROFILE must be "development" or "production".');
}

export function resolveApplicationDataDirectory(appDataDirectory: string, isPackaged: boolean, requestedProfile?: string): string {
  const profile = resolveApplicationDataProfile(isPackaged, requestedProfile);
  return path.join(appDataDirectory, profile === 'production' ? 'yuheng' : 'yuheng-dev');
}
