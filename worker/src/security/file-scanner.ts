import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { SANDBOX } from './sandbox-config';
import { logger } from '../logger';

export interface ScanResult {
  clean: boolean;
  threats: ScanThreat[];
  stats: { filesScanned: number; totalBytes: number };
}

export interface ScanThreat {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  file: string;
  detail: string;
}

// ── Dangerous file extensions ───────────────────────────────────────────────
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.sh', '.bash',
  '.msi', '.scr', '.pif', '.com', '.hta', '.jar', '.class',
]);

// ── Extensions allowed in an Android project ────────────────────────────────
const ALLOWED_EXTENSIONS = new Set([
  '.java', '.kt', '.kts', '.xml', '.gradle', '.json', '.yaml', '.yml',
  '.properties', '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.svg', '.ico', '.ttf', '.otf', '.woff', '.woff2',
  '.mp3', '.mp4', '.ogg', '.wav', '.aac', '.html', '.css', '.js',
  '.ts', '.dart', '.zip', '.so', '.a', '.aar', '.jar', '.jks',
  '.keystore', '.gitignore', '.gitattributes', '', // no extension
]);

// ── Suspicious source-code patterns (regex) ─────────────────────────────────
const SUSPICIOUS_CODE_PATTERNS: Array<{ pattern: RegExp; type: string; severity: ScanThreat['severity']; detail: string }> = [
  {
    pattern: /Runtime\.getRuntime\(\)\.exec\s*\([^)]*?(rm|wget|curl|bash|sh|powershell)/i,
    type: 'COMMAND_EXEC',
    severity: 'critical',
    detail: 'Runtime.exec() with shell command',
  },
  {
    pattern: /ProcessBuilder\s*\(\s*["']?(rm|bash|sh|curl|wget|nc|ncat|netcat)/i,
    type: 'PROCESS_BUILDER_SHELL',
    severity: 'critical',
    detail: 'ProcessBuilder launching shell/network tool',
  },
  {
    pattern: /Base64\.decode\([^)]+\).*eval|eval.*Base64\.decode/s,
    type: 'BASE64_EVAL',
    severity: 'high',
    detail: 'Encoded payload execution pattern',
  },
  {
    pattern: /\bSystem\.load(Library)?\s*\(\s*["']\/data\//,
    type: 'DYNAMIC_LIB_LOAD',
    severity: 'high',
    detail: 'Loading native library from writable path',
  },
  {
    pattern: /DexClassLoader|PathClassLoader.*:\/data\//,
    type: 'DYNAMIC_CODE_LOAD',
    severity: 'high',
    detail: 'Dynamic code loading from external path',
  },
  {
    pattern: /http[s]?:\/\/(?!repo1\.maven\.org|dl\.google\.com|jcenter\.bintray\.com|plugins\.gradle\.org|services\.gradle\.org|jitpack\.io|maven\.google\.com)/i,
    type: 'SUSPICIOUS_URL',
    severity: 'medium',
    detail: 'Unknown external URL in build script',
  },
  {
    pattern: /curl\s+[-\w]*\s+https?:\/\/.*\|\s*(bash|sh|python|perl)/i,
    type: 'CURL_PIPE_SHELL',
    severity: 'critical',
    detail: 'curl-pipe-shell execution pattern',
  },
  {
    pattern: /\bexec\s*\(\s*["'`].*?["'`]\s*\)/,
    type: 'EXEC_STRING',
    severity: 'medium',
    detail: 'exec() with string literal in Gradle script',
  },
  {
    pattern: /android:debuggable\s*=\s*["']true["']/,
    type: 'FORCE_DEBUGGABLE',
    severity: 'low',
    detail: 'Manifest forces debuggable=true (informational)',
  },
  {
    pattern: /android:allowBackup\s*=\s*["']true["']/,
    type: 'ALLOW_BACKUP',
    severity: 'low',
    detail: 'Manifest allows backup (informational)',
  },
];

// ── Gradle-specific malicious patterns ──────────────────────────────────────
const GRADLE_MALICIOUS: Array<{ pattern: RegExp; type: string; severity: ScanThreat['severity']; detail: string }> = [
  {
    pattern: /task\s+\w+\s*\{[^}]*?\bexec\s*\{[^}]*?commandLine[^}]*?(rm|del|format|mkfs|dd\s)/i,
    type: 'GRADLE_DESTRUCTIVE_TASK',
    severity: 'critical',
    detail: 'Gradle task executing destructive OS command',
  },
  {
    pattern: /apply\s+from\s*:\s*["']https?:\/\//,
    type: 'REMOTE_SCRIPT_APPLY',
    severity: 'high',
    detail: 'Gradle applying remote script — code injection risk',
  },
  {
    pattern: /repositories\s*\{[^}]*?maven\s*\{[^}]*?url\s*=?\s*["'](?!https:\/\/(repo1\.maven\.org|dl\.google\.com|jcenter\.bintray\.com|plugins\.gradle\.org|jitpack\.io|maven\.google\.com))/i,
    type: 'UNTRUSTED_REPO',
    severity: 'medium',
    detail: 'Maven repository from untrusted host',
  },
];

export class FileScanner {
  async scan(dir: string): Promise<ScanResult> {
    const threats: ScanThreat[] = [];
    let filesScanned = 0;
    let totalBytes = 0;

    const files = await this.walkDir(dir);

    for (const filePath of files) {
      const rel = path.relative(dir, filePath);

      // Skip binary files we can't meaningfully scan
      const ext = path.extname(filePath).toLowerCase();

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }

      filesScanned++;
      totalBytes += stat.size;

      // 1. Extension check
      if (DANGEROUS_EXTENSIONS.has(ext)) {
        threats.push({
          severity: 'high',
          type: 'DANGEROUS_EXTENSION',
          file: rel,
          detail: `File with dangerous extension: ${ext}`,
        });
        continue;
      }

      // 2. Single file size limit (skip scan for large binaries)
      if (stat.size > 50 * 1024 * 1024) {
        // 50MB single file
        if (!['.so', '.aar', '.jar', '.zip'].includes(ext)) {
          threats.push({
            severity: 'medium',
            type: 'OVERSIZED_SOURCE_FILE',
            file: rel,
            detail: `Source file too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB`,
          });
        }
        continue;
      }

      // 3. Only scan text-like files for code patterns
      if (this.isTextFile(ext)) {
        const codeThreats = await this.scanCodePatterns(filePath, rel, ext);
        threats.push(...codeThreats);
      }
    }

    const clean = threats.filter((t) => t.severity === 'critical' || t.severity === 'high').length === 0;

    if (!clean) {
      logger.warn(`Security scan found ${threats.length} threat(s)`, {
        critical: threats.filter((t) => t.severity === 'critical').length,
        high: threats.filter((t) => t.severity === 'high').length,
      });
    }

    return { clean, threats, stats: { filesScanned, totalBytes } };
  }

  private async scanCodePatterns(
    filePath: string,
    rel: string,
    ext: string,
  ): Promise<ScanThreat[]> {
    const threats: ScanThreat[] = [];

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const patterns = [
        ...SUSPICIOUS_CODE_PATTERNS,
        ...(ext === '.gradle' || ext === '.kts' ? GRADLE_MALICIOUS : []),
      ];

      for (const { pattern, type, severity, detail } of patterns) {
        if (pattern.test(content)) {
          threats.push({ severity, type, file: rel, detail });
        }
      }
    } catch {
      // Binary file — skip content scan
    }

    return threats;
  }

  private isTextFile(ext: string): boolean {
    const textExts = new Set([
      '.java', '.kt', '.kts', '.gradle', '.xml', '.json', '.yaml',
      '.yml', '.properties', '.txt', '.md', '.sh', '.bash', '.py',
      '.rb', '.js', '.ts', '.html', '.css', '.dart', '.groovy',
    ]);
    return textExts.has(ext);
  }

  private async walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden dirs (e.g., .git), node_modules, build output
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') {
        continue;
      }

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.walkDir(full)));
      } else if (entry.isFile()) {
        results.push(full);
      }
    }

    return results;
  }

  // ── Archive bomb detection (used before extraction) ─────────────────────
  async checkZipBomb(zipPath: string): Promise<{ safe: boolean; reason?: string }> {
    const stat = await fs.stat(zipPath);
    const compressedSize = stat.size;

    if (compressedSize > SANDBOX.MAX_PROJECT_SIZE_BYTES) {
      return {
        safe: false,
        reason: `ZIP too large: ${(compressedSize / 1024 / 1024).toFixed(0)}MB (max ${SANDBOX.MAX_PROJECT_SIZE_BYTES / 1024 / 1024}MB)`,
      };
    }

    // Read ZIP central directory to get uncompressed sizes without extracting
    try {
      const buf = await fs.readFile(zipPath);
      let totalUncompressed = 0;
      let fileCount = 0;

      // Scan for Local File Header signatures (PK\x03\x04)
      for (let i = 0; i < buf.length - 30; i++) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
          const uncompressedSize = buf.readUInt32LE(i + 22);
          totalUncompressed += uncompressedSize;
          fileCount++;

          if (totalUncompressed > SANDBOX.MAX_EXTRACTED_BYTES) {
            return {
              safe: false,
              reason: `ZIP bomb: would extract to ${(totalUncompressed / 1024 / 1024 / 1024).toFixed(1)}GB`,
            };
          }

          const ratio = totalUncompressed / Math.max(compressedSize, 1);
          if (ratio > SANDBOX.MAX_ZIP_RATIO && totalUncompressed > 50 * 1024 * 1024) {
            return {
              safe: false,
              reason: `ZIP bomb: compression ratio ${ratio.toFixed(0)}x exceeds ${SANDBOX.MAX_ZIP_RATIO}x limit`,
            };
          }
        }
      }

      if (fileCount > 50_000) {
        return { safe: false, reason: `ZIP contains too many files: ${fileCount}` };
      }
    } catch (err) {
      logger.warn(`ZIP bomb check parse error: ${err.message} — proceeding with caution`);
    }

    return { safe: true };
  }
}
