import { BadRequestException } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { DEFAULT_ZIP_LIMITS } from './zip-validator';

const run = promisify(execFile);

export type RepoSource =
  | { kind: 'repo'; owner: string; repo: string; cloneUrl: string; treePath: string[] }
  | { kind: 'zip'; owner: string; repo: string; url: string };

const SEG = /^[A-Za-z0-9_.-]{1,100}$/;
const bad = (m: string): never => { throw new BadRequestException(m); };

const SUPPORTED =
  'Use https://github.com/<owner>/<repo>, https://github.com/<owner>/<repo>/tree/<branch>/<folder> ' +
  'or a GitHub ZIP link (https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip).';

/** Strictly parses what a user may paste: a GitHub repository, branch/folder, or ZIP link. */
export function parseRepoUrl(raw: string): RepoSource {
  let u: URL;
  try { u = new URL((raw || '').trim()); } catch { return bad(`Invalid URL. ${SUPPORTED}`); }
  if (u.protocol !== 'https:') bad(`Only https:// URLs are accepted. ${SUPPORTED}`);
  if (u.username || u.password || u.port) bad('The URL must not contain credentials or a port.');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com' && host !== 'codeload.github.com') bad(`Only GitHub repositories are supported. ${SUPPORTED}`);

  let segs: string[];
  try { segs = u.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return bad('Invalid URL encoding.'); }
  if (segs.length < 2) bad(`Missing repository name. ${SUPPORTED}`);
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (!SEG.test(owner) || !SEG.test(repo) || owner === '.' || owner === '..' || repo === '.' || repo === '..') bad('Invalid owner or repository name.');

  if (host === 'codeload.github.com') {
    if (segs[2] !== 'zip' || segs.length < 4) bad(`Unsupported codeload URL. ${SUPPORTED}`);
    return { kind: 'zip', owner, repo, url: `https://codeload.github.com/${owner}/${repo}/${segs.slice(2).map(encodeURIComponent).join('/')}` };
  }
  if (segs.length === 2) return { kind: 'repo', owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git`, treePath: [] };
  if (segs[2] === 'tree' && segs.length >= 4) {
    const treePath = segs.slice(3);
    if (treePath.length > 20 || treePath.some((s) => !s || s === '.' || s === '..' || /[\\\0/]/.test(s))) bad('Invalid folder path in URL.');
    return { kind: 'repo', owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git`, treePath };
  }
  if (segs[2] === 'archive' && segs.length >= 4 && segs[segs.length - 1].endsWith('.zip')) {
    return { kind: 'zip', owner, repo, url: `https://github.com/${owner}/${repo}/${segs.slice(2).map(encodeURIComponent).join('/')}` };
  }
  return bad(`Unsupported GitHub URL. ${SUPPORTED}`);
}

const GIT_ENV = (home: string) => ({
  PATH: process.env.PATH, HOME: home, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  LANG: 'C', ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
  ...(process.env.SSL_CERT_FILE ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE, GIT_SSL_CAINFO: process.env.SSL_CERT_FILE } : {}),
});

export interface GitOptions { allowFile?: boolean } // tests clone from a local repository

function protocolArgs(o: GitOptions): string[] {
  return ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...(o.allowFile ? ['-c', 'protocol.file.allow=always'] : [])];
}

async function git(args: string[], opts: { cwd?: string; timeout: number }, o: GitOptions): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'git-home-'));
  try {
    const { stdout } = await run('git', [...protocolArgs(o), ...args], {
      cwd: opts.cwd, timeout: opts.timeout, env: GIT_ENV(home), maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

/** Branch/tag names of a remote; throws a user-facing error when the repo is private or missing. */
export async function listRemoteRefs(cloneUrl: string, o: GitOptions = {}): Promise<string[]> {
  try {
    const out = await git(['ls-remote', '--heads', '--tags', '--', cloneUrl], { timeout: 30_000 }, o);
    return out.split('\n').map((l) => l.split('\t')[1] || '').filter(Boolean)
      .map((r) => r.replace(/^refs\/(heads|tags)\//, '').replace(/\^\{\}$/, ''));
  } catch {
    return bad('Repository not found, private, or unreachable. Only public GitHub repositories can be imported by URL.');
  }
}

/** /tree/<ref>/<folder> is ambiguous when branch names contain '/': pick the longest matching ref. */
export function splitTreePath(treePath: string[], refs: string[]): { ref: string; subdir: string } {
  for (let i = treePath.length; i >= 1; i--) {
    const ref = treePath.slice(0, i).join('/');
    if (refs.includes(ref)) return { ref, subdir: treePath.slice(i).join('/') };
  }
  return bad(`Branch or tag "${treePath[0]}" was not found in the repository.`);
}

export async function cloneRepo(cloneUrl: string, dest: string, ref: string | undefined, o: GitOptions = {}): Promise<void> {
  const args = ['clone', '--depth=1', '--single-branch', '--no-tags', '--no-recurse-submodules', '-c', 'core.symlinks=false',
    ...(ref ? ['--branch', ref] : []), '--', cloneUrl, dest];
  try {
    await git(args, { timeout: 120_000 }, o);
  } catch (err: any) {
    return bad(`Failed to clone the repository: ${/timed out|ETIMEDOUT|killed/i.test(String(err.message)) ? 'timeout' : 'not found or not accessible'}.`);
  }
  // symlinks are written as plain files (core.symlinks=false); refuse repositories that contain any
  const tree = await git(['ls-files', '-s'], { cwd: dest, timeout: 30_000 }, o);
  const link = tree.split('\n').find((l) => l.startsWith('120000'));
  if (link) bad(`Symbolic links are not allowed in repositories: ${link.split('\t')[1]?.slice(0, 80)}`);
  await fs.rm(path.join(dest, '.git'), { recursive: true, force: true });
}

async function walkSize(dir: string, budget: { files: number; bytes: number }): Promise<void> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) bad('Symbolic links are not allowed.');
    if (e.isDirectory()) await walkSize(full, budget);
    else if (e.isFile()) {
      budget.files++;
      budget.bytes += (await fs.stat(full)).size;
      if (budget.files > DEFAULT_ZIP_LIMITS.maxEntries) bad(`The repository has too many files (limit ${DEFAULT_ZIP_LIMITS.maxEntries}).`);
      if (budget.bytes > DEFAULT_ZIP_LIMITS.maxTotalBytes) bad(`The repository is larger than ${Math.round(DEFAULT_ZIP_LIMITS.maxTotalBytes / 1048576)} MB.`);
    }
  }
}
export const assertWithinLimits = (dir: string) => walkSize(dir, { files: 0, bytes: 0 });

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const SKIP = new Set(['.git', 'node_modules', 'build', '.gradle']);

async function hasManifest(dir: string, depth = 0): Promise<boolean> {
  if (depth > 6) return false;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === 'AndroidManifest.xml') return true;
    if (e.isDirectory() && !SKIP.has(e.name)) if (await hasManifest(path.join(dir, e.name), depth + 1)) return true;
  }
  return false;
}

/**
 * Finds the Android Gradle project (with wrapper) at `base` or up to two folders below it.
 * Returns the absolute project root, or throws an actionable error.
 */
export async function findGradleProject(base: string): Promise<string> {
  const dirs = [base];
  const level = async (parents: string[]) => {
    const next: string[] = [];
    for (const p of parents) for (const e of await fs.readdir(p, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) next.push(path.join(p, e.name));
    }
    return next;
  };
  const l1 = await level([base]); const l2 = await level(l1);
  dirs.push(...l1, ...l2);

  const candidates: string[] = [];
  let sawGradle = false;
  for (const d of dirs) {
    const gradle = (await exists(path.join(d, 'settings.gradle'))) || (await exists(path.join(d, 'settings.gradle.kts'))) ||
      (await exists(path.join(d, 'build.gradle'))) || (await exists(path.join(d, 'build.gradle.kts')));
    if (gradle) sawGradle = true;
    const wrapper = (await exists(path.join(d, 'gradlew'))) && (await exists(path.join(d, 'gradle/wrapper/gradle-wrapper.properties'))) &&
      (await exists(path.join(d, 'gradle/wrapper/gradle-wrapper.jar')));
    if (gradle && wrapper && (await hasManifest(d))) candidates.push(d);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const rel = candidates.map((c) => path.relative(base, c) || '.').join(', ');
    return bad(`Several Android Gradle projects found (${rel}). Paste the URL of the folder, e.g. https://github.com/<owner>/<repo>/tree/<branch>/<folder>.`);
  }
  if (!sawGradle) return bad('No Gradle project found: the repository must contain build.gradle / settings.gradle.');
  return bad('No complete Android Gradle project found. It needs gradlew, gradle/wrapper/gradle-wrapper.properties, gradle/wrapper/gradle-wrapper.jar and an AndroidManifest.xml.');
}
