export interface ParsedError {
  type: string;
  message: string;
  file?: string;
  line?: number;
}

export interface BuildProgress {
  phase: string;
  percent: number;
  task?: string;
}

export class LogParser {
  private static readonly ERROR_PATTERNS: Array<{
    regex: RegExp;
    type: string;
    extract: (m: RegExpMatchArray, line: string) => Partial<ParsedError>;
  }> = [
    {
      regex: /Could not resolve (.+)\./,
      type: 'DEPENDENCY_UNRESOLVED',
      extract: (m) => ({ message: `Cannot resolve: ${m[1]}` }),
    },
    {
      regex: /Duplicate class (.+) found in/,
      type: 'DUPLICATE_CLASS',
      extract: (m) => ({ message: `Duplicate class: ${m[1]}` }),
    },
    {
      regex: /compileSdkVersion .+ is too high/,
      type: 'SDK_VERSION_HIGH',
      extract: (_, l) => ({ message: l.trim() }),
    },
    {
      regex: /minSdkVersion (\d+) cannot be smaller than version (\d+)/,
      type: 'SDK_MIN_TOO_LOW',
      extract: (m) => ({ message: `minSdkVersion ${m[1]} too low, needs ${m[2]}` }),
    },
    {
      regex: /error: package (.+) does not exist/,
      type: 'PACKAGE_NOT_FOUND',
      extract: (m) => ({ message: `Package not found: ${m[1]}` }),
    },
    {
      regex: /Manifest merger failed : (.+)/,
      type: 'MANIFEST_MERGE',
      extract: (m) => ({ message: m[1] }),
    },
    {
      regex: /AAPT: error: (.+)/,
      type: 'AAPT_ERROR',
      extract: (m) => ({ message: m[1] }),
    },
    {
      regex: /error: unresolved reference: (.+)/,
      type: 'UNRESOLVED_REF',
      extract: (m) => ({ message: `Unresolved reference: ${m[1]}` }),
    },
    {
      regex: /Could not find method (.+)\(\)/,
      type: 'DEPRECATED_API',
      extract: (m) => ({ message: `Deprecated method: ${m[1]}()` }),
    },
    {
      regex: /Plugin with id '(.+)' not found/,
      type: 'PLUGIN_NOT_FOUND',
      extract: (m) => ({ message: `Plugin not found: ${m[1]}` }),
    },
    {
      regex: /The SDK Build Tools revision .+ is too low/,
      type: 'BUILD_TOOLS_TOO_LOW',
      extract: (_, l) => ({ message: l.trim() }),
    },
    {
      regex: /Kotlin: (.+error.+)/i,
      type: 'KOTLIN_ERROR',
      extract: (m) => ({ message: m[1] }),
    },
    {
      regex: /java\.lang\.OutOfMemoryError/,
      type: 'OOM',
      extract: () => ({ message: 'Out of memory during build' }),
    },
  ];

  private static readonly PROGRESS_PATTERNS: Array<{
    regex: RegExp;
    phase: string;
    percent: number;
  }> = [
    { regex: /^> Configure project/, phase: 'Configuring', percent: 10 },
    { regex: /> Task :app:preBuild/, phase: 'Pre-build', percent: 20 },
    { regex: /> Task :app:compileDebugKotlin|> Task :app:compileReleaseKotlin/, phase: 'Compiling Kotlin', percent: 40 },
    { regex: /> Task :app:compileDebugJavaWithJavac|> Task :app:compileReleaseJavaWithJavac/, phase: 'Compiling Java', percent: 50 },
    { regex: /> Task :app:mergeDebugResources|> Task :app:mergeReleaseResources/, phase: 'Merging Resources', percent: 60 },
    { regex: /> Task :app:processDebugManifest|> Task :app:processReleaseManifest/, phase: 'Processing Manifest', percent: 65 },
    { regex: /> Task :app:packageDebug|> Task :app:packageRelease/, phase: 'Packaging APK', percent: 85 },
    { regex: /> Task :app:assembleDebug|> Task :app:assembleRelease/, phase: 'Assembling', percent: 95 },
    { regex: /BUILD SUCCESSFUL/, phase: 'Done', percent: 100 },
  ];

  parseErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const seen = new Set<string>();

    for (const line of output.split('\n')) {
      for (const pattern of LogParser.ERROR_PATTERNS) {
        const match = line.match(pattern.regex);
        if (match) {
          const extracted = pattern.extract(match, line);
          const key = `${pattern.type}:${extracted.message}`;
          if (!seen.has(key)) {
            seen.add(key);
            errors.push({ type: pattern.type, ...extracted } as ParsedError);
          }
          break;
        }
      }
    }
    return errors;
  }

  parseProgress(line: string): BuildProgress | null {
    for (const p of LogParser.PROGRESS_PATTERNS) {
      if (p.regex.test(line)) {
        const taskMatch = line.match(/> Task (.+)/);
        return { phase: p.phase, percent: p.percent, task: taskMatch?.[1] };
      }
    }
    return null;
  }

  classifyLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' {
    const l = line.toLowerCase();
    if (l.includes('error:') || l.includes('exception') || l.includes('failed')) return 'error';
    if (l.includes('warning:') || l.includes('warn:') || l.includes('deprecated')) return 'warn';
    if (l.startsWith('> task') || l.includes('build successful') || l.includes('build failed')) return 'info';
    return 'debug';
  }

  isBuildSuccess(output: string): boolean {
    return output.includes('BUILD SUCCESSFUL');
  }

  isBuildFailure(output: string): boolean {
    return output.includes('BUILD FAILED');
  }

  extractApkPath(output: string, projectPath: string): string | null {
    // Standard debug APK location
    const patterns = [
      /app\/build\/outputs\/apk\/debug\/(.+\.apk)/,
      /app\/build\/outputs\/apk\/release\/(.+\.apk)/,
      /build\/outputs\/apk\/debug\/(.+\.apk)/,
    ];
    for (const p of patterns) {
      const m = output.match(p);
      if (m) return `${projectPath}/app/build/outputs/apk/debug/${m[1]}`;
    }
    return null;
  }
}
