/** Release APK and AAB are enabled unless ENABLE_RELEASE_BUILDS is false or 0. */
export function releaseBuildsEnabled(raw: string | undefined = process.env.ENABLE_RELEASE_BUILDS): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return true;
  return value === 'true' || value === '1' || value === 'yes';
}
