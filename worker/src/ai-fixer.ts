import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';
import { ParsedError } from './log-parser';

export interface FixResult {
  success: boolean;
  description: string;
  filesModified: string[];
  errorSummary: string;
}

export class AiFixer {
  async fix(
    projectPath: string,
    errors: ParsedError[],
    attempt: number,
  ): Promise<FixResult> {
    const buildFiles = await this.readBuildFiles(projectPath);
    if (Object.keys(buildFiles).length === 0) {
      return { success: false, description: 'No build files found', filesModified: [], errorSummary: '' };
    }

    const errorSummary = errors.map((e) => `[${e.type}] ${e.message}`).join('\n');

    // Try AI fix first, fall back to rule-based
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let patches: Array<{ file: string; content: string; description: string }> = [];

    if (apiKey) {
      patches = await this.llmFix(buildFiles, errors, attempt, apiKey);
    }

    if (patches.length === 0) {
      patches = this.ruleBasedFix(buildFiles, errors);
    }

    if (patches.length === 0) {
      return { success: false, description: 'No applicable fixes found', filesModified: [], errorSummary };
    }

    // Apply patches
    const filesModified: string[] = [];
    for (const patch of patches) {
      const filePath = path.join(projectPath, patch.file);
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, patch.content, 'utf-8');
        filesModified.push(patch.file);
        logger.info(`Applied fix to ${patch.file}: ${patch.description}`);
      } catch (err) {
        logger.error(`Failed to write fix to ${filePath}: ${err.message}`);
      }
    }

    return {
      success: filesModified.length > 0,
      description: patches.map((p) => p.description).join('; '),
      filesModified,
      errorSummary,
    };
  }

  private async readBuildFiles(projectPath: string): Promise<Record<string, string>> {
    const targets = [
      'build.gradle',
      'build.gradle.kts',
      'app/build.gradle',
      'app/build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
      'gradle.properties',
      'gradle/wrapper/gradle-wrapper.properties',
    ];

    const files: Record<string, string> = {};
    for (const rel of targets) {
      try {
        files[rel] = await fs.readFile(path.join(projectPath, rel), 'utf-8');
      } catch {}
    }
    return files;
  }

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

Return ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "patches": [
    {
      "file": "relative/path/to/file",
      "content": "COMPLETE new file content",
      "description": "What was fixed"
    }
  ]
}

Guidelines:
- Use compileSdkVersion 34, targetSdkVersion 34, minSdkVersion 21 for SDK conflicts
- Add google() and mavenCentral() repositories if missing
- Replace deprecated 'compile' with 'implementation'
- Add packagingOptions excludes for duplicate classes
- Fix Kotlin version to match AGP requirements
- Return COMPLETE file content, never partial`;

    try {
      const resp = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-opus-4-6',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        },
      );

      const text = resp.data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      if (!jsonMatch) return [];

      const result = JSON.parse(jsonMatch[0]);
      return result.patches || [];
    } catch (err) {
      logger.error(`LLM fix failed: ${err.message}`);
      return [];
    }
  }

  private ruleBasedFix(
    buildFiles: Record<string, string>,
    errors: ParsedError[],
  ): Array<{ file: string; content: string; description: string }> {
    const patches: Array<{ file: string; content: string; description: string }> = [];
    const errorTypes = new Set(errors.map((e) => e.type));

    for (const [file, content] of Object.entries(buildFiles)) {
      let patched = content;
      const applied: string[] = [];

      if (errorTypes.has('SDK_VERSION_HIGH') || errorTypes.has('SDK_MIN_TOO_LOW') || errorTypes.has('SDK_CONFIG_ERROR')) {
        patched = patched
          .replace(/compileSdkVersion\s+\d+/g, 'compileSdkVersion 34')
          .replace(/targetSdkVersion\s+\d+/g, 'targetSdkVersion 34')
          .replace(/minSdkVersion\s+\d+/g, 'minSdkVersion 21')
          .replace(/compileSdk\s*=\s*\d+/g, 'compileSdk = 34')
          .replace(/targetSdk\s*=\s*\d+/g, 'targetSdk = 34')
          .replace(/minSdk\s*=\s*\d+/g, 'minSdk = 21');
        applied.push('Fixed SDK versions (compile=34, target=34, min=21)');
      }

      if (errorTypes.has('DUPLICATE_CLASS') && !patched.includes('packagingOptions')) {
        patched = patched.replace(
          /android\s*\{/,
          `android {\n    packagingOptions {\n        exclude 'META-INF/DEPENDENCIES'\n        exclude 'META-INF/LICENSE'\n        exclude 'META-INF/NOTICE'\n        exclude 'META-INF/*.kotlin_module'\n    }`,
        );
        applied.push('Added packagingOptions for duplicate class exclusions');
      }

      if (errorTypes.has('DEPENDENCY_UNRESOLVED') || errorTypes.has('PLUGIN_NOT_FOUND')) {
        if (!patched.includes('mavenCentral()')) {
          patched = patched.replace(
            /repositories\s*\{([^}]*)\}/g,
            (match, inner) => `repositories {${inner}        google()\n        mavenCentral()\n        maven { url 'https://jitpack.io' }\n    }`,
          );
          applied.push('Added Google, MavenCentral and JitPack repositories');
        }
      }

      if (errorTypes.has('DEPRECATED_API')) {
        patched = patched
          .replace(/\bcompile\s+/g, 'implementation ')
          .replace(/\btestCompile\s+/g, 'testImplementation ')
          .replace(/\bandroidTestCompile\s+/g, 'androidTestImplementation ');
        applied.push('Replaced deprecated compile with implementation');
      }

      if (errorTypes.has('BUILD_TOOLS_TOO_LOW')) {
        patched = patched.replace(
          /buildToolsVersion\s+["'][\d.]+["']/g,
          "buildToolsVersion '34.0.0'",
        );
        applied.push('Updated buildToolsVersion to 34.0.0');
      }

      if (errorTypes.has('OOM')) {
        if (file === 'gradle.properties') {
          if (!patched.includes('org.gradle.jvmargs')) {
            patched += '\norg.gradle.jvmargs=-Xmx4096m -XX:MaxPermSize=512m\norg.gradle.parallel=true\n';
          } else {
            patched = patched.replace(
              /org\.gradle\.jvmargs=.*/,
              'org.gradle.jvmargs=-Xmx4096m -XX:MaxPermSize=512m',
            );
          }
          applied.push('Increased Gradle JVM heap size to 4GB');
        }
      }

      if (applied.length > 0 && patched !== content) {
        patches.push({ file, content: patched, description: applied.join('; ') });
      }
    }

    return patches;
  }
}
