const fs = require('fs');
const p = '/opt/flutter/bin/internal/update_engine_version.sh';
const text = fs.readFileSync(p, 'utf8');
if (text.includes('APK Factory: the build container rootfs is read-only')) process.exit(0);
const needle = 'FLUTTER_ROOT="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")"\n';
if (!text.includes(needle)) {
  console.error('flutter stamp script layout changed');
  process.exit(1);
}
const insert = `${needle}
# APK Factory: the build container rootfs is read-only. A precached stamp is enough.
if [ ! -w "$FLUTTER_ROOT/bin/cache" ] && [ -f "$FLUTTER_ROOT/bin/cache/engine.stamp" ]; then
  exit 0
fi
`;
fs.writeFileSync(p, text.replace(needle, insert));
