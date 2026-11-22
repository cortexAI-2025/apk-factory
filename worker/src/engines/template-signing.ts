/**
 * React Native CLI and Expo (prebuild) templates assign the Android debug keystore to the
 * release build type. Gradle then produces a release APK/AAB that is "already signed", the
 * release-signing stage keeps it, and a "signed release" ships with CN=Android Debug
 * (observed on CI run 45012681180: react-native AAB). Drop only that template assignment,
 * on the workspace copy, unless the project declares its own release keystore.
 */
import * as fs from 'fs';
import * as path from 'path';

const GRADLE_FILES = ['android/app/build.gradle.kts', 'android/app/build.gradle'];

/** Pure text transform, also embedded verbatim in the in-sandbox shell step (keep it self-contained). */
export function stripTemplateDebugSigning(text: string): string {
  const own = /signingConfig\s*=?\s*signingConfigs(?:\.getByName\(\s*["']release["']\s*\)|\.release)\b|\brelease\s*\{[^{}]*\bstoreFile\b|create\(\s*["']release["']\s*\)/;
  if (own.test(text)) return text;
  return text.replace(/^[ \t]*signingConfig\s*=?\s*signingConfigs(?:\.getByName\(\s*["']debug["']\s*\)|\.debug)[ \t]*$/gm, '');
}

export function stripTemplateDebugSigningInProject(projectRoot: string): boolean {
  let changed = false;
  for (const rel of GRADLE_FILES) {
    const file = path.join(projectRoot, rel);
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    const next = stripTemplateDebugSigning(original);
    if (next !== original) { fs.writeFileSync(file, next); changed = true; }
  }
  return changed;
}

/** Shell line that applies the same transform inside the build container, relative to the project root. */
export function stripTemplateDebugSigningShell(tag: string): string {
  const script = [
    'const fs=require("fs");',
    `const strip=${stripTemplateDebugSigning.toString().replace(/^function\s+\w*/, 'function').replace(/\s*\n\s*/g, ' ')};`,
    `for(const rel of ${JSON.stringify(GRADLE_FILES)}){`,
    'if(!fs.existsSync(rel)) continue;',
    'const o=fs.readFileSync(rel,"utf8"); const n=strip(o);',
    `if(n!==o){fs.writeFileSync(rel,n);console.log("[engine:${tag}] removed template debug signing from "+rel);}`,
    '}',
  ].join('');
  return `node -e ${JSON.stringify(script)}`;
}
