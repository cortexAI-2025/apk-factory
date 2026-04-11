import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface GradleError {
  type: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface FixPatch {
  file: string;
  originalContent: string;
  patchedContent: string;
  description: string;
}

export interface AutoFixResult {
  success: boolean;
  description: string;
  patches: FixPatch[];
  errorSummary: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly config: ConfigService) {}

  parseGradleErrors(logOutput: string): GradleError[] {
    const errors: GradleError[] = [];
    const lines = logOutput.split('\n');

    const patterns = [
      {
        regex: /Could not resolve (.+)\./,
        type: 'DEPENDENCY_UNRESOLVED',
        extract: (m: RegExpMatchArray) => ({ message: `Cannot resolve dependency: ${m[1]}` }),
      },
      {
        regex: /Duplicate class (.+) found in/,
        type: 'DUPLICATE_CLASS',
        extract: (m: RegExpMatchArray) => ({ message: `Duplicate class: ${m[1]}` }),
      },
      {
        regex: /compileSdkVersion .+ is too high/,
        type: 'SDK_VERSION_MISMATCH',
        extract: () => ({ message: 'compileSdkVersion is too high for this Gradle version' }),
      },
      {
        regex: /error: package (.+) does not exist/,
        type: 'PACKAGE_NOT_FOUND',
        extract: (m: RegExpMatchArray) => ({ message: `Package not found: ${m[1]}` }),
      },
      {
        regex: /minSdkVersion (.+) is greater than targetSdkVersion/,
        type: 'SDK_CONFIG_ERROR',
        extract: (m: RegExpMatchArray) => ({ message: `SDK version conflict: ${m[1]}` }),
      },
      {
        regex: /Kotlin: .*(error|Error)/,
        type: 'KOTLIN_COMPILE_ERROR',
        extract: (m: RegExpMatchArray) => ({ message: `Kotlin compilation error: ${m[0]}` }),
      },
      {
        regex: /Could not find method (.+)\(\) for arguments/,
        type: 'DEPRECATED_GRADLE_API',
        extract: (m: RegExpMatchArray) => ({ message: `Deprecated Gradle API: ${m[1]}` }),
      },
      {
        regex: /Manifest merger failed/,
        type: 'MANIFEST_MERGE_FAILURE',
        extract: () => ({ message: 'AndroidManifest.xml merger failed' }),
      },
      {
        regex: /AAPT: error: (.+)/,
        type: 'AAPT_ERROR',
        extract: (m: RegExpMatchArray) => ({ message: `Resource error: ${m[1]}` }),
      },
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          const extracted = pattern.extract(match);
          errors.push({
            type: pattern.type,
            ...extracted,
          });
          break;
        }
      }
    }

    // Deduplicate by type
    const seen = new Set<string>();
    return errors.filter((e) => {
      if (seen.has(e.type + e.message)) return false;
      seen.add(e.type + e.message);
      return true;
    });
  }

  async generateFix(
    errors: GradleError[],
    buildFiles: Record<string, string>,
    attempt: number,
  ): Promise<AutoFixResult> {
    const apiKey = this.config.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set, using rule-based fixes only');
      return this.applyRuleBasedFixes(errors, buildFiles);
    }

    const errorSummary = errors.map((e) => `[${e.type}] ${e.message}`).join('\n');
    const filesContext = Object.entries(buildFiles)
      .map(([file, content]) => `=== ${file} ===\n${content}`)
      .join('\n\n');

    const prompt = `You are an Android build expert. Fix these Gradle build errors (attempt ${attempt}/3).

ERRORS:
${errorSummary}

BUILD FILES:
${filesContext}

Return ONLY valid JSON in this exact format:
{
  "description": "Brief description of what was fixed",
  "patches": [
    {
      "file": "relative/path/to/file",
      "patchedContent": "FULL new content of the file",
      "description": "What changed in this file"
    }
  ]
}

Rules:
- Fix dependency version conflicts by using stable versions
- For SDK mismatches, use compileSdkVersion 34, minSdkVersion 21, targetSdkVersion 34
- For duplicate classes, add packagingOptions exclusions
- For Kotlin errors, ensure kotlin_version matches
- Always return the COMPLETE file content, not just the diff`;

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      const text = response.data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      if (!jsonMatch) throw new Error('No JSON in AI response');

      const result = JSON.parse(jsonMatch[0]);
      const patches: FixPatch[] = result.patches.map((p: any) => ({
        file: p.file,
        originalContent: buildFiles[p.file] || '',
        patchedContent: p.patchedContent,
        description: p.description,
      }));

      return {
        success: true,
        description: result.description,
        patches,
        errorSummary,
      };
    } catch (err) {
      this.logger.error(`AI fix failed: ${err.message}, falling back to rule-based`);
      return this.applyRuleBasedFixes(errors, buildFiles);
    }
  }

  private applyRuleBasedFixes(
    errors: GradleError[],
    buildFiles: Record<string, string>,
  ): AutoFixResult {
    const patches: FixPatch[] = [];
    const fixDescriptions: string[] = [];

    for (const [file, content] of Object.entries(buildFiles)) {
      let patched = content;
      let changed = false;

      for (const error of errors) {
        switch (error.type) {
          case 'SDK_VERSION_MISMATCH':
          case 'SDK_CONFIG_ERROR':
            patched = patched
              .replace(/compileSdkVersion\s+\d+/, 'compileSdkVersion 34')
              .replace(/targetSdkVersion\s+\d+/, 'targetSdkVersion 34')
              .replace(/minSdkVersion\s+\d+/, 'minSdkVersion 21');
            changed = true;
            fixDescriptions.push('Fixed SDK versions to compileSdk=34, targetSdk=34, minSdk=21');
            break;

          case 'DUPLICATE_CLASS':
            if (!patched.includes('packagingOptions')) {
              patched = patched.replace(
                /android\s*\{/,
                `android {\n    packagingOptions {\n        exclude 'META-INF/DEPENDENCIES'\n        exclude 'META-INF/LICENSE'\n        exclude 'META-INF/NOTICE'\n    }`,
              );
              changed = true;
              fixDescriptions.push('Added packagingOptions to resolve duplicate classes');
            }
            break;

          case 'DEPENDENCY_UNRESOLVED':
            // Add Google and Maven Central repositories
            if (!patched.includes('mavenCentral()')) {
              patched = patched.replace(
                /repositories\s*\{/,
                `repositories {\n        google()\n        mavenCentral()\n        maven { url 'https://jitpack.io' }`,
              );
              changed = true;
              fixDescriptions.push('Added missing repositories (Google, MavenCentral, JitPack)');
            }
            break;

          case 'DEPRECATED_GRADLE_API':
            patched = patched
              .replace(/compile\s+/g, 'implementation ')
              .replace(/testCompile\s+/g, 'testImplementation ')
              .replace(/androidTestCompile\s+/g, 'androidTestImplementation ');
            changed = true;
            fixDescriptions.push('Updated deprecated compile configurations to implementation');
            break;
        }
      }

      if (changed) {
        patches.push({
          file,
          originalContent: content,
          patchedContent: patched,
          description: fixDescriptions.join('; '),
        });
      }
    }

    return {
      success: patches.length > 0,
      description: fixDescriptions.join('; ') || 'No rule-based fixes applicable',
      patches,
      errorSummary: errors.map((e) => `[${e.type}] ${e.message}`).join('\n'),
    };
  }
}
