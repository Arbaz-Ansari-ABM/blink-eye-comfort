// Facts shown in the APK download section.
//  - sizeBytes is read from the real public/Blink.apk file at build time (see vite.config.js).
//  - versionName and minAndroid were read from the APK's own AndroidManifest.xml
//    (versionName "1.0", minSdkVersion 26 = Android 8.0). If you replace Blink.apk with a new
//    build, update these two values to match it.
export const APK_INFO = {
  fileName: 'Blink.apk',
  href: '/Blink.apk',
  sizeBytes: typeof __APK_SIZE_BYTES__ !== 'undefined' ? __APK_SIZE_BYTES__ : 0,
  versionName: '1.0',
  minAndroid: '8.0',
};

// Decimal megabytes: this matches what Chrome and most Android file managers display.
export function formatApkSize(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
