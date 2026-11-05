import { redact } from './security/redact';

export interface Diagnosis {
  code: string;
  summary: string;   // one line, user-facing
  hint?: string;     // what to do about it
  excerpt: string[]; // relevant (redacted) log lines
}

/** Gradle's own "* What went wrong:" section, if present. */
function whatWentWrong(lines: string[]): string[] {
  const i = lines.findIndex((l) => /^\*\s*What went wrong:/.test(l.trim()));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const t = l.trim();
    if (/^\*\s*(Try|Exception is|Get more help)/.test(t) || /^BUILD FAILED/.test(t)) break;
    if (t) out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

export function diagnoseFailure(output: string, exitCode?: number): Diagnosis {
  const lines = output.split(/\r?\n/);
  const wrong = whatWentWrong(lines);
  const text = output;
  const ex = (a: string[]) => a.map((l) => redact(l)).slice(0, 8);
  const javac = lines.filter((l) => /\.(java|kt):\d+(:\d+)?:?\s*error:/.test(l)).slice(0, 5);

  if (exitCode === 124) {
    return { code: 'TIMEOUT', summary: 'The build exceeded the time limit and was stopped.',
      hint: 'Check for an endless task or very slow dependency downloads; the limit is BUILD_TIMEOUT_MS.', excerpt: [] };
  }
  if (exitCode === 125) {
    return { code: 'DISK_LIMIT', summary: 'The build exceeded its disk quota and was stopped.',
      hint: 'Remove large generated files from the project; the quota is BUILD_MAX_WORKSPACE_MB.', excerpt: [] };
  }
  if (/OutOfMemoryError|Java heap space|GC overhead limit/.test(text) || exitCode === 137) {
    return { code: 'OUT_OF_MEMORY', summary: 'The build ran out of memory.',
      hint: 'Reduce org.gradle.jvmargs in gradle.properties or raise BUILD_MEMORY.', excerpt: ex(wrong) };
  }
  if (/No space left on device/.test(text)) {
    return { code: 'NO_SPACE', summary: 'The sandbox ran out of disk space.', excerpt: ex(wrong) };
  }
  if (/GradleWrapperMain|gradle-wrapper\.jar/.test(text) && /(ClassNotFound|Could not find or load main class|Error: Unable to access jarfile)/.test(text)) {
    return { code: 'WRAPPER_BROKEN', summary: 'The Gradle wrapper is missing or corrupted.',
      hint: 'Commit gradlew and gradle/wrapper/gradle-wrapper.jar (regenerate with "gradle wrapper").', excerpt: ex(wrong) };
  }
  const hostMatch = text.match(/(?:Could not (?:GET|HEAD|resolve)|Connect to|Unable to tunnel through proxy|Read timed out|UnknownHostException)[^\n]*?(?:https?:\/\/|:\s*)([A-Za-z0-9.-]+\.[a-z]{2,})/);
  if (/(UnknownHostException|Could not GET|Could not HEAD|Unable to tunnel|Connect to .* failed|Network is unreachable|403 Forbidden)/.test(text) && hostMatch) {
    return { code: 'NETWORK_BLOCKED', summary: `A dependency could not be downloaded from ${hostMatch[1]}.`,
      hint: 'The build sandbox only reaches an allow-list of Maven/Gradle hosts. If this host is legitimate, an administrator must add it to docker/egress-proxy/allowed-domains.txt.',
      excerpt: ex(wrong) };
  }
  if (/Could not resolve (all files|all dependencies|[\w.-]+:[\w.-]+)/.test(text)) {
    const m = text.match(/Could not resolve ([\w.-]+:[\w.-]+(?::[\w.+-]+)?)/);
    return { code: 'DEPENDENCY_UNRESOLVED', summary: `Dependency could not be resolved${m ? `: ${m[1]}` : ''}.`,
      hint: 'Check the coordinates/version and that the repository (google(), mavenCentral()) is declared.', excerpt: ex(wrong) };
  }
  if (/SDK location not found|Failed to install the following Android SDK packages|License for package .* not accepted|Failed to find (Build Tools|Target with hash)/i.test(text)) {
    const m = text.match(/(?:Failed to find Build Tools revision ([\d.]+)|Failed to find target with hash string '([^']+)')/i);
    return { code: 'SDK_COMPONENT_MISSING', summary: `Required Android SDK component is not available${m ? ` (${m[1] || m[2]})` : ''}.`,
      hint: 'The sandbox image ships platforms 29–34 and build-tools 30–34. Lower compileSdk/buildToolsVersion or extend the builder image.', excerpt: ex(wrong) };
  }
  if (/Unsupported class file major version|requires Java \d+|Android Gradle plugin requires Java|Unsupported Java\./i.test(text)) {
    return { code: 'JAVA_MISMATCH', summary: 'Java/Gradle/Android Gradle Plugin versions are incompatible.',
      hint: 'The sandbox uses JDK 17. Use Gradle ≥ 7.3 with AGP ≥ 7.0 (AGP 8.x needs JDK 17).', excerpt: ex(wrong) };
  }
  if (/Plugin \[id: '[^']+'\] was not found|Plugin with id '[^']+' not found/.test(text)) {
    const m = text.match(/(?:Plugin \[id: '([^']+)'\] was not found|Plugin with id '([^']+)' not found)/);
    return { code: 'PLUGIN_NOT_FOUND', summary: `Gradle plugin not found: ${(m && (m[1] || m[2])) || 'unknown'}.`,
      hint: 'Declare the plugin repository (google(), gradlePluginPortal()) in settings.gradle pluginManagement.', excerpt: ex(wrong) };
  }
  if (javac.length) {
    return { code: 'COMPILATION_ERROR', summary: `Compilation failed: ${redact(javac[0].trim()).slice(0, 160)}`,
      hint: 'Fix the reported source errors and re-import the project.', excerpt: ex(javac) };
  }
  if (/AAPT: error|AAPT2|Android resource linking failed|Manifest merger failed/.test(text)) {
    return { code: 'RESOURCE_ERROR', summary: 'Android resources or manifest could not be processed.', excerpt: ex(wrong) };
  }
  if (wrong.length) {
    return { code: 'GRADLE_FAILURE', summary: `Gradle build failed: ${redact(wrong[0]).slice(0, 200)}`, excerpt: ex(wrong) };
  }
  return {
    code: 'UNKNOWN', summary: `The build failed (exit code ${exitCode ?? '?'}) without a recognised cause.`,
    hint: 'Open the build log for the last lines printed by Gradle.', excerpt: ex(lines.filter((l) => l.trim()).slice(-6)),
  };
}

/** Compact multi-line message stored as Build.errorMessage. */
export function formatDiagnosis(d: Diagnosis): string {
  const parts = [`[${d.code}] ${d.summary}`];
  if (d.hint) parts.push(`Hint: ${d.hint}`);
  if (d.excerpt.length) parts.push(...d.excerpt.map((l) => `  ${l}`));
  return parts.join('\n');
}
