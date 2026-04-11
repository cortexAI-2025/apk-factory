import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';
import { ParsedError } from './log-parser';

export interface FilePatch {
  file:    string;
  before:  string;
  after:   string;
  diff:    string;   // unified diff
}

export interface FixResult {
  success:       boolean;
  description:   string;
  filesModified: string[];
  errorSummary:  string;
  patches:       FilePatch[];
}

export class AiFixer {
  async fix(
    projectPath: string,
    errors: ParsedError[],
    attempt: number,
  ): Promise<FixResult> {
    const buildFiles = await this.readBuildFiles(projectPath);
    if (Object.keys(buildFiles).length === 0) {
      return { success: false, description: 'No build files found', filesModified: [], errorSummary: '', patches: [] };
    }

    const errorSummary = errors.map((e) => `[${e.type}] ${e.message}`).join('\n');
    let rawPatches: Array<{ file: string; content: string; description: string }> = [];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      rawPatches = await this.llmFix(buildFiles, errors, attempt, apiKey);
    }

    if (rawPatches.length === 0) {
      rawPatches = this.ruleBasedFix(buildFiles, errors);
    }

    if (rawPatches.length === 0) {
      return { success: false, description: 'No applicable fixes found', filesModified: [], errorSummary, patches: [] };
    }

    // Apply patches and build FilePatch objects
    const patches: FilePatch[] = [];
    const filesModified: string[] = [];

    for (const raw of rawPatches) {
      const filePath = path.join(projectPath, raw.file);
      const before   = buildFiles[raw.file] || '';
      const after    = raw.content;

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, after, 'utf-8');
        filesModified.push(raw.file);

        patches.push({
          file:   raw.file,
          before,
          after,
          diff:   generateUnifiedDiff(raw.file, before, after),
        });

        logger.info(`[fix] Patched ${raw.file}: ${raw.description}`);
      } catch (err: any) {
        logger.error(`[fix] Failed to write ${filePath}: ${err.message}`);
      }
    }

    return {
      success:       filesModified.length > 0,
      description:   rawPatches.map((p) => p.description).join('; '),
      filesModified,
      errorSummary,
      patches,
    };
  }

  // ── Private: read build files ─────────────────────────────────────────────
  private async readBuildFiles(projectPath: string): Promise<Record<string, string>> {
    const targets = [
      'build.gradle', 'build.gradle.kts',
      'app/build.gradle', 'app/build.gradle.kts',
      'settings.gradle', 'settings.gradle.kts',
      'gradle.properties',
      'gradle/wrapper/gradle-wrapper.properties',
    ];
    const files: Record<string, string> = {};
    for (const rel of targets) {
      try { files[rel] = await fs.readFile(path.join(projectPath, rel), 'utf-8'); } catch {}
    }
    return files;
  }

  // ── Private: Claude LLM fix ───────────────────────────────────────────────
  private async llmFix(
    buildFiles: Record<string, string>,
    errors: ParsedError[],
    attempt: number,
    apiKey: string,
  ): Promise<Array<{ file: string; content: string; description: string }>> {
    const errorSummary = errors.map((e) => `[${e.type}] ${e.message}`).join('\n');
    const filesContext = Object.entries(buildFiles)
      .map(([f, c]) => `=== ${f} ===\n${c}`)
      .join('\n\n');

    const prompt = `You are an Android build expert fixing Gradle errors (attempt ${attempt}/3).

BUILD ERRORS:
${errorSummary}

CURRENT BUILD FILES:
${filesContext}

Return ONLY a JSON object (no markdown outside JSON):
{
  "patches": [
    {
      "file": "relative/path/to/file",
      "content": "COMPLETE new file content",
      "description": "Concise description of what was fixed"
    }
  ]
}

Rules:
- compileSdkVersion 34, targetSdkVersion 34, minSdkVersion 21 for SDK conflicts
- Add google() and mavenCentral() if repos are missing
- Replace deprecated 'compile' with 'implementation'
- Add packagingOptions excludes for duplicate class errors
- Return COMPLETE file content, never partial snippets`;

    try {
      const resp = await axios.post(
        'https://api.anthropic.com/v1/messages',
        { model: 'claude-opus-4-6', max_tokens: 8192, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeout: 90000 },
      );
      const text  = resp.data.content[0].text;
      const match = text.match(/\{[\s\S]+\}/);
      if (!match) return [];
      return JSON.parse(match[0]).patches || [];
    } catch (err: any) {
      logger.error(`[fix] LLM call failed: ${err.message}`);
      return [];
    }
  }

  // ── Private: rule-based fallback ──────────────────────────────────────────
  private ruleBasedFix(
    buildFiles: Record<string, string>,
    errors: ParsedError[],
  ): Array<{ file: string; content: string; description: string }> {
    const patches: Array<{ file: string; content: string; description: string }> = [];
    const types = new Set(errors.map((e) => e.type));

    for (const [file, content] of Object.entries(buildFiles)) {
      let patched = content;
      const applied: string[] = [];

      if (types.has('SDK_VERSION_HIGH') || types.has('SDK_MIN_TOO_LOW') || types.has('SDK_CONFIG_ERROR')) {
        patched = patched
          .replace(/compileSdkVersion\s+\d+/g, 'compileSdkVersion 34')
          .replace(/targetSdkVersion\s+\d+/g,  'targetSdkVersion 34')
          .replace(/minSdkVersion\s+\d+/g,      'minSdkVersion 21')
          .replace(/compileSdk\s*=\s*\d+/g,     'compileSdk = 34')
          .replace(/targetSdk\s*=\s*\d+/g,      'targetSdk = 34')
          .replace(/minSdk\s*=\s*\d+/g,         'minSdk = 21');
        applied.push('Fixed SDK versions (compileSdk=34, targetSdk=34, minSdk=21)');
      }

      if (types.has('DUPLICATE_CLASS') && !patched.includes('packagingOptions')) {
        patched = patched.replace(
          /android\s*\{/,
          `android {\n    packagingOptions {\n        exclude 'META-INF/DEPENDENCIES'\n        exclude 'META-INF/LICENSE'\n        exclude 'META-INF/*.kotlin_module'\n    }`,
        );
        applied.push('Added packagingOptions to resolve duplicate classes');
      }

      if ((types.has('DEPENDENCY_UNRESOLVED') || types.has('PLUGIN_NOT_FOUND')) && !patched.includes('mavenCentral()')) {
        patched = patched.replace(
          /repositories\s*\{/g,
          `repositories {\n        google()\n        mavenCentral()\n        maven { url 'https://jitpack.io' }`,
        );
        applied.push('Added Google, MavenCentral and JitPack repositories');
      }

      if (types.has('DEPRECATED_API')) {
        patched = patched
          .replace(/\bcompile\s+/g, 'implementation ')
          .replace(/\btestCompile\s+/g, 'testImplementation ')
          .replace(/\bandroidTestCompile\s+/g, 'androidTestImplementation ');
        applied.push('Replaced deprecated compile → implementation');
      }

      if (types.has('BUILD_TOOLS_TOO_LOW')) {
        patched = patched.replace(/buildToolsVersion\s+["'][\d.]+["']/g, "buildToolsVersion '34.0.0'");
        applied.push('Updated buildToolsVersion to 34.0.0');
      }

      if (types.has('OOM') && file === 'gradle.properties') {
        if (!patched.includes('org.gradle.jvmargs')) {
          patched += '\norg.gradle.jvmargs=-Xmx4096m -XX:MaxPermSize=512m\norg.gradle.parallel=true\n';
        } else {
          patched = patched.replace(/org\.gradle\.jvmargs=.*/g, 'org.gradle.jvmargs=-Xmx4096m -XX:MaxPermSize=512m');
        }
        applied.push('Increased Gradle JVM heap to 4GB');
      }

      if (applied.length > 0 && patched !== content) {
        patches.push({ file, content: patched, description: applied.join('; ') });
      }
    }

    return patches;
  }
}

// ── Unified diff generator ────────────────────────────────────────────────────
function generateUnifiedDiff(filename: string, before: string, after: string): string {
  if (before === after) return '';

  const beforeLines = before.split('\n');
  const afterLines  = after.split('\n');
  const hunks: string[] = [];

  hunks.push(`--- a/${filename}`);
  hunks.push(`+++ b/${filename}`);

  // Simple line-by-line diff (LCS-based would be better, this is practical)
  const beforeSet = new Set(beforeLines);
  const afterSet  = new Set(afterLines);

  let i = 0, j = 0;
  let hunkLines: string[] = [];
  let hunkStartA = 1, hunkStartB = 1, countA = 0, countB = 0;
  let inHunk = false;

  const flush = () => {
    if (hunkLines.length > 0) {
      hunks.push(`@@ -${hunkStartA},${countA} +${hunkStartB},${countB} @@`);
      hunks.push(...hunkLines);
      hunkLines = [];
      countA = 0;
      countB = 0;
      inHunk = false;
    }
  };

  // Build a simple unified diff by comparing line arrays
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  let aIdx = 0, bIdx = 0;

  while (aIdx < beforeLines.length || bIdx < afterLines.length) {
    const aLine = beforeLines[aIdx];
    const bLine = afterLines[bIdx];

    if (aLine === bLine) {
      if (inHunk) {
        hunkLines.push(` ${aLine}`);
        countA++; countB++;
      }
      aIdx++; bIdx++;
    } else {
      if (!inHunk) {
        hunkStartA = aIdx + 1;
        hunkStartB = bIdx + 1;
        inHunk = true;
        // Add up to 3 context lines before
        const ctxStart = Math.max(0, aIdx - 3);
        for (let c = ctxStart; c < aIdx; c++) {
          hunkLines.push(` ${beforeLines[c]}`);
          countA++; countB++;
        }
      }

      if (aIdx < beforeLines.length && (bIdx >= afterLines.length || !afterLines.includes(aLine))) {
        hunkLines.push(`-${aLine}`);
        countA++;
        aIdx++;
      } else if (bIdx < afterLines.length) {
        hunkLines.push(`+${bLine}`);
        countB++;
        bIdx++;
      }
    }

    // Flush after 5 context lines of non-changes
    if (inHunk && hunkLines.length > 50) {
      flush();
    }
  }

  flush();
  return hunks.join('\n');
}
