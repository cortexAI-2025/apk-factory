/**
 * Flutter engine.
 *
 * `flutter build apk` / `flutter build appbundle` drive the Android embedding.
 * A missing android/ directory is created with `flutter create` (does not
 * overwrite lib/ or pubspec.yaml).
 *
 * One fat APK/AAB is produced for arm, arm64 and x64 (no per-ABI split), so
 * artifact selection stays unambiguous. The factory upload key is applied
 * after this script exits; it is not passed to Flutter or Gradle.
 *
 * The Flutter template sets -Xmx8G and -XX:MaxMetaspaceSize=4G. On the worker
 * memory budget that daemon is OOM-killed (observed: "Gradle build daemon
 * disappeared unexpectedly"). The cap below rewrites only the isolated
 * workspace copy, before Gradle starts.
 */
import fs from 'fs';
import path from 'path';
import { BuildEngine, ComposedCommand } from './types';
import { PipelineContext } from '../pipeline/types';

const ABIS = 'android-arm,android-arm64,android-x64';

const HEAP_CAP_MB = 1024;
const META_CAP_MB = 768;
const CODE_CAP_MB = 128;

function flagMb(num: string, unit: string): number {
  const n = parseInt(num, 10);
  return unit.toLowerCase() === 'g' ? n * 1024 : n;
}

/**
 * Lower an oversized Gradle heap in android/gradle.properties.
 * Returns true when the workspace copy was rewritten.
 * A missing file, or a heap already under the cap, is left untouched.
 */
export function capFlutterGradleHeap(projectRoot: string): boolean {
  const propsPath = path.join(projectRoot, 'android', 'gradle.properties');
  if (!projectRoot || !fs.existsSync(propsPath)) return false;
  const original = fs.readFileSync(propsPath, 'utf8');
  let text = original;
  const cap = (re: RegExp, limit: number, replacement: string) => {
    text = text.replace(re, (all, n: string, u: string) => (flagMb(n, u) > limit ? replacement : all));
  };
  cap(/-Xmx(\d+)([gGmM])/g, HEAP_CAP_MB, `-Xmx${HEAP_CAP_MB}m`);
  cap(/-XX:MaxMetaspaceSize=(\d+)([gGmM])/g, META_CAP_MB, `-XX:MaxMetaspaceSize=${META_CAP_MB}m`);
  cap(/-XX:ReservedCodeCacheSize=(\d+)([gGmM])/g, CODE_CAP_MB, `-XX:ReservedCodeCacheSize=${CODE_CAP_MB}m`);
  if (text === original) return false;
  text = text.replace(/\s*-XX:\+HeapDumpOnOutOfMemoryError/g, '');
  if (/org\.gradle\.daemon\s*=/.test(text)) {
    text = text.replace(/org\.gradle\.daemon\s*=\s*true/gi, 'org.gradle.daemon=false');
  } else {
    text += (text.endsWith('\n') ? '' : '\n') + 'org.gradle.daemon=false\n';
  }
  if (!/org\.gradle\.workers\.max\s*=/.test(text)) {
    text += 'org.gradle.workers.max=1\n';
  }
  fs.writeFileSync(propsPath, text);
  return true;
}

const DEBUG_SIGNING_LINE = /^[ \t]*signingConfig\s*=?\s*signingConfigs(?:\.getByName\(\s*["']debug["']\s*\)|\.debug)\s*$/gm;
const PROJECT_RELEASE_KEY = /\bstoreFile\b|signingConfig\s*=?\s*signingConfigs(?:\.getByName\(\s*["']release["']\s*\)|\.release)\b/;

/**
 * The Flutter template assigns the debug keystore to the release build type
 * ("so flutter run --release works"). apksigner then treats that APK as
 * already signed, and the factory upload key is correctly not applied.
 * Drop only that template assignment, on the workspace copy, and only when
 * the module does not already declare a release keystore.
 * Returns true when a file was rewritten.
 */
export function stripFlutterTemplateDebugSigning(projectRoot: string): boolean {
  if (!projectRoot) return false;
  let changed = false;
  for (const rel of ['android/app/build.gradle.kts', 'android/app/build.gradle']) {
    const file = path.join(projectRoot, rel);
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    if (PROJECT_RELEASE_KEY.test(original)) continue;
    DEBUG_SIGNING_LINE.lastIndex = 0;
    const next = original.replace(DEBUG_SIGNING_LINE, '');
    if (next === original) continue;
    fs.writeFileSync(file, next);
    changed = true;
  }
  return changed;
}

function flutterInvocation(ctx: PipelineContext, extraGradleArgs?: string): string {
  const tail = extraGradleArgs ? ` -- ${extraGradleArgs}` : '';
  if (ctx.buildType === 'AAB') return `flutter build appbundle --release --target-platform ${ABIS}${tail}`;
  if (ctx.buildType === 'RELEASE') return `flutter build apk --release --target-platform ${ABIS}${tail}`;
  return `flutter build apk --debug --target-platform ${ABIS}${tail}`;
}

export const flutterEngine: BuildEngine = {
  id: 'FLUTTER',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const root = ctx.projectRoot || ctx.workspaceDir;
    const releaseLike = ctx.buildType === 'RELEASE' || ctx.buildType === 'AAB';
    if (root) {
      try { capFlutterGradleHeap(root); } catch { /* Flutter reports a real properties error later */ }
      if (releaseLike) {
        try { stripFlutterTemplateDebugSigning(root); } catch { /* the shell step retries on the workspace copy */ }
      }
    }
    // `flutter create` may write the 8G template after the host-side cap.
    // Re-apply the same limits inside the sandbox, on the workspace copy only.
    const capInside = [
      'const fs=require("fs");',
      'const p="android/gradle.properties";',
      'if(!fs.existsSync(p)) process.exit(0);',
      'let t=fs.readFileSync(p,"utf8"); const orig=t;',
      'const mb=(n,u)=>String(u).toLowerCase()==="g"?parseInt(n,10)*1024:parseInt(n,10);',
      'const cap=(re,limit,rep)=>{t=t.replace(re,(all,n,u)=>mb(n,u)>limit?rep:all);};',
      `cap(/-Xmx(\\d+)([gGmM])/g,${HEAP_CAP_MB},"-Xmx${HEAP_CAP_MB}m");`,
      `cap(/-XX:MaxMetaspaceSize=(\\d+)([gGmM])/g,${META_CAP_MB},"-XX:MaxMetaspaceSize=${META_CAP_MB}m");`,
      `cap(/-XX:ReservedCodeCacheSize=(\\d+)([gGmM])/g,${CODE_CAP_MB},"-XX:ReservedCodeCacheSize=${CODE_CAP_MB}m");`,
      'if(t===orig) process.exit(0);',
      't=t.replace(/\\s*-XX:\\+HeapDumpOnOutOfMemoryError/g,"");',
      'if(/org\\.gradle\\.daemon\\s*=/.test(t)) t=t.replace(/org\\.gradle\\.daemon\\s*=\\s*true/gi,"org.gradle.daemon=false");',
      'else t+=(t.endsWith("\\n")?"":"\\n")+"org.gradle.daemon=false\\n";',
      'if(!/org\\.gradle\\.workers\\.max\\s*=/.test(t)) t+="org.gradle.workers.max=1\\n";',
      'fs.writeFileSync(p,t);',
      'console.log("[engine:flutter] capped Gradle heap on the workspace copy");',
    ].join('');
    // `flutter create` can rewrite the template after the host-side strip.
    // Same rule: never touch a module that already has a release keystore.
    const stripInside = [
      'const fs=require("fs");',
      'const files=["android/app/build.gradle.kts","android/app/build.gradle"];',
      'const line=/^[ \\t]*signingConfig\\s*=?\\s*signingConfigs(?:\\.getByName\\(\\s*[\'"]debug[\'"]\\s*\\)|\\.debug)\\s*$/gm;',
      'const keep=/\\bstoreFile\\b|signingConfig\\s*=?\\s*signingConfigs(?:\\.getByName\\(\\s*[\'"]release[\'"]\\s*\\)|\\.release)\\b/;',
      'for (const rel of files) {',
      'if (!fs.existsSync(rel)) continue;',
      'const orig=fs.readFileSync(rel,"utf8");',
      'if (keep.test(orig)) continue;',
      'const next=orig.replace(line,"");',
      'if (next!==orig) { fs.writeFileSync(rel,next); console.log("[engine:flutter] removed template debug signing from "+rel); }',
      '}',
    ].join('');
    const script = [
      'set -euo pipefail',
      'command -v flutter >/dev/null 2>&1 || { echo "[engine:flutter] flutter is not installed in this build image"; exit 127; }',
      'flutter --version',
      'if [ ! -d android ]; then',
      '  echo "[engine:flutter] android/ missing — adding the Android embedding"',
      '  flutter create --platforms=android .',
      'fi',
      `node -e ${JSON.stringify(capInside)}`,
      ...(releaseLike ? [`node -e ${JSON.stringify(stripInside)}`] : []),
      'if [ -f android/gradle.properties ]; then echo "[engine:flutter] $(grep -E "^org\\.gradle\\.jvmargs=" android/gradle.properties || true)"; fi',
      'flutter pub get',
      flutterInvocation(ctx, extraGradleArgs),
    ].join('\n');
    return { command: script, shell: true };
  },
};
