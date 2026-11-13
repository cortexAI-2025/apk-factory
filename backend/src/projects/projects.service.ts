import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LifecycleService } from '../lifecycle/lifecycle.service';
import { inspectZip } from './zip-validator';
import {
  parseRepoUrl, listRemoteRefs, splitTreePath, cloneRepo, assertWithinLimits, findGradleProject,
} from './repo-source';
import { CreateProjectFromUrlDto } from './dto/create-project.dto';
import { ProjectSourceType, ProjectType } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as unzipper from 'extract-zip';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

interface AndroidProjectAnalysis {
  projectType: ProjectType;
  gradleVersion?: string;
  sdkVersion?: number;
  kotlinVersion?: string;
  javaVersion?: string;
  compatibilityScore: number;
  hasGradleWrapper: boolean;
  mainBuildFile?: string;
  appName?: string;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly lifecycle: LifecycleService,
  ) {}

  async createFromZip(
    userId: string,
    file: Pick<Express.Multer.File, 'buffer' | 'originalname'>,
    name?: string,
    description?: string,
    origin?: { sourceType: ProjectSourceType; sourceUrl: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No ZIP file received (field "file").');

    const projectId = uuidv4();
    const projectDir = await this.storage.createProjectDir(projectId);
    const zipPath = path.join(projectDir, 'source.zip');
    const extractDir = path.join(projectDir, 'source');

    const reject = async (err: any): Promise<never> => {
      await this.storage.deleteDir(projectDir); // never keep a rejected archive
      throw err instanceof BadRequestException
        ? err
        : new BadRequestException(`Failed to import ZIP: ${String(err?.message || err).slice(0, 160)}`);
    };

    try {
      await fs.writeFile(zipPath, file.buffer);
      const inspection = await inspectZip(zipPath, file.buffer.subarray(0, 4));
      await fs.mkdir(extractDir, { recursive: true });
      await unzipper(zipPath, { dir: extractDir });
      await this.assertNoLinks(extractDir);
      await fs.rm(zipPath, { force: true });

      const projectRoot = path.join(extractDir, inspection.rootPrefix);
      const analysis = await this.analyzeProject(projectRoot);
      const projectName = (name || path.basename(file.originalname, '.zip')).slice(0, 80);

      return await this.prisma.project.create({
        data: {
          id: projectId,
          name: projectName,
          description,
          sourceType: origin?.sourceType ?? ProjectSourceType.ZIP_UPLOAD,
          sourceUrl: origin?.sourceUrl,
          sourcePath: projectRoot,
          projectType: analysis.projectType,
          gradleVersion: analysis.gradleVersion,
          sdkVersion: analysis.sdkVersion,
          kotlinVersion: analysis.kotlinVersion,
          compatibilityScore: analysis.compatibilityScore,
          metadata: analysis as any,
          userId,
        },
      });
    } catch (err) {
      return reject(err);
    }
  }

  /** Defense in depth: nothing but regular files and directories may exist after extraction. */
  private async assertNoLinks(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new BadRequestException('Symbolic links are not allowed in archives.');
      if (entry.isDirectory()) await this.assertNoLinks(full);
      else if (!entry.isFile()) throw new BadRequestException('Special files are not allowed in archives.');
    }
  }

  /** Import from a GitHub repository URL (optionally /tree/<branch>/<folder>) or a GitHub ZIP link. */
  async createFromUrl(userId: string, dto: CreateProjectFromUrlDto) {
    const src = parseRepoUrl(dto.sourceUrl);
    const sourceType = dto.sourceType ?? ProjectSourceType.GITHUB_URL;

    if (src.kind === 'zip') {
      const buffer = await this.downloadGithubZip(src.url);
      return this.createFromZip(
        userId, { buffer, originalname: `${src.repo}.zip` }, dto.name || src.repo, dto.description,
        { sourceType, sourceUrl: src.url },
      );
    }

    const projectId = uuidv4();
    const projectDir = await this.storage.createProjectDir(projectId);
    const cloneDir = path.join(projectDir, 'source');
    try {
      this.logger.log(`Importing ${src.owner}/${src.repo}`);
      let ref: string | undefined;
      let subdir = '';
      if (src.treePath.length) {
        ({ ref, subdir } = splitTreePath(src.treePath, await listRemoteRefs(src.cloneUrl)));
      }
      await cloneRepo(src.cloneUrl, cloneDir, ref);
      await assertWithinLimits(cloneDir);

      const base = path.resolve(cloneDir, subdir);
      if (base !== cloneDir && !base.startsWith(cloneDir + path.sep)) throw new BadRequestException('Invalid folder path.');
      if (!(await this.storage.fileExists(base))) throw new BadRequestException(`Folder "${subdir}" does not exist in the repository.`);
      const projectRoot = await findGradleProject(base);
      const analysis = await this.analyzeProject(projectRoot);
      const defaultName = (subdir ? path.basename(subdir) : src.repo) || src.repo;

      return await this.prisma.project.create({
        data: {
          id: projectId,
          name: (dto.name || defaultName).slice(0, 80),
          description: dto.description,
          sourceType,
          sourceUrl: dto.sourceUrl.trim(),
          sourcePath: projectRoot,
          projectType: analysis.projectType,
          gradleVersion: analysis.gradleVersion,
          sdkVersion: analysis.sdkVersion,
          kotlinVersion: analysis.kotlinVersion,
          compatibilityScore: analysis.compatibilityScore,
          metadata: analysis as any,
          userId,
        },
      });
    } catch (err: any) {
      await this.storage.deleteDir(projectDir); // never keep a rejected import
      throw err instanceof BadRequestException
        ? err
        : new BadRequestException(`Failed to import repository: ${String(err?.message || err).slice(0, 160)}`);
    }
  }

  /** Streams a GitHub-hosted ZIP with a hard size cap; redirects may only stay on GitHub hosts. */
  private async downloadGithubZip(url: string): Promise<Buffer> {
    const max = parseInt(process.env.ZIP_MAX_UPLOAD_MB || '200', 10) * 1024 * 1024;
    const allowed = new Set(['github.com', 'codeload.github.com']);
    try {
      const res = await axios.get(url, {
        responseType: 'stream', timeout: 120_000, maxRedirects: 3, validateStatus: (s) => s === 200,
        beforeRedirect: (opts: any) => {
          if (opts.protocol !== 'https:' || !allowed.has(String(opts.hostname).toLowerCase())) throw new Error('redirect to a non-GitHub host');
        },
      });
      const chunks: Buffer[] = [];
      let size = 0;
      await new Promise<void>((resolve, reject) => {
        res.data.on('data', (c: Buffer) => {
          size += c.length;
          if (size > max) { res.data.destroy(); reject(new BadRequestException(`The ZIP is larger than ${Math.round(max / 1048576)} MB.`)); return; }
          chunks.push(c);
        });
        res.data.on('end', resolve);
        res.data.on('error', reject);
      });
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Could not download the ZIP from GitHub (not found, private, or unreachable).');
    }
  }

  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          builds: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, createdAt: true, apkUrl: true },
          },
          _count: { select: { builds: true } },
        },
      }),
      this.prisma.project.count({ where: { userId } }),
    ]);

    return { projects, total, page, limit };
  }

  async findOne(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        builds: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            buildType: true,
            createdAt: true,
            finishedAt: true,
            duration: true,
            apkUrl: true,
            apkSize: true,
            errorMessage: true,
            autoFixAttempts: true,
          },
        },
        _count: { select: { builds: true } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) throw new ForbiddenException();

    return project;
  }

  async delete(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) throw new ForbiddenException();

    // Removes sources, APK/AAB + QR artifacts of every build, then DB rows
    await this.lifecycle.deleteProject(projectId);
    return { deleted: true };
  }

  private async findProjectRoot(dir: string): Promise<string> {
    // Check if build.gradle exists at root
    try {
      await fs.access(path.join(dir, 'build.gradle'));
      return dir;
    } catch {}
    try {
      await fs.access(path.join(dir, 'build.gradle.kts'));
      return dir;
    } catch {}

    // Look one level deeper
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subDir = path.join(dir, entry.name);
        try {
          await fs.access(path.join(subDir, 'build.gradle'));
          return subDir;
        } catch {}
        try {
          await fs.access(path.join(subDir, 'build.gradle.kts'));
          return subDir;
        } catch {}
      }
    }
    return dir;
  }

  async analyzeProject(projectPath: string): Promise<AndroidProjectAnalysis> {
    const analysis: AndroidProjectAnalysis = {
      projectType: ProjectType.UNKNOWN,
      compatibilityScore: 0,
      hasGradleWrapper: false,
    };

    let score = 0;

    // Check for Flutter
    try {
      await fs.access(path.join(projectPath, 'pubspec.yaml'));
      analysis.projectType = ProjectType.FLUTTER;
      score += 30;
    } catch {}

    // Check for React Native
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'),
      );
      if (pkg.dependencies?.['react-native'] || pkg.devDependencies?.['react-native']) {
        analysis.projectType = ProjectType.REACT_NATIVE;
        score += 30;
      }
    } catch {}

    // Check for Android native
    try {
      await fs.access(path.join(projectPath, 'build.gradle'));
      if (analysis.projectType === ProjectType.UNKNOWN) {
        analysis.projectType = ProjectType.ANDROID_NATIVE;
      }
      score += 40;
    } catch {}
    try {
      await fs.access(path.join(projectPath, 'build.gradle.kts'));
      if (analysis.projectType === ProjectType.UNKNOWN) {
        analysis.projectType = ProjectType.ANDROID_NATIVE;
      }
      score += 40;
    } catch {}

    // Check Gradle wrapper
    try {
      await fs.access(path.join(projectPath, 'gradlew'));
      analysis.hasGradleWrapper = true;
      score += 20;
    } catch {}

    // Parse Gradle properties for versions
    try {
      const propsContent = await fs.readFile(
        path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
        'utf-8',
      );
      const match = propsContent.match(/gradle-([\d.]+)-/);
      if (match) {
        analysis.gradleVersion = match[1];
        score += 10;
      }
    } catch {}

    // Parse build.gradle for SDK version
    for (const gradleFile of ['app/build.gradle', 'app/build.gradle.kts', 'build.gradle']) {
      try {
        const content = await fs.readFile(path.join(projectPath, gradleFile), 'utf-8');

        const sdkMatch = content.match(/compileSdkVersion\s+(\d+)/);
        if (sdkMatch) {
          analysis.sdkVersion = parseInt(sdkMatch[1]);
          score += 10;
        }

        const kotlinMatch = content.match(/kotlin[_-]version\s*[=:]\s*["']?([\d.]+)/i);
        if (kotlinMatch) {
          analysis.kotlinVersion = kotlinMatch[1];
        }

        analysis.mainBuildFile = gradleFile;
        break;
      } catch {}
    }

    // Check AndroidManifest for app name
    try {
      const manifestContent = await fs.readFile(
        path.join(projectPath, 'app', 'src', 'main', 'AndroidManifest.xml'),
        'utf-8',
      );
      const nameMatch = manifestContent.match(/android:label="([^"]+)"/);
      if (nameMatch) analysis.appName = nameMatch[1];
      score += 10;
    } catch {}

    analysis.compatibilityScore = Math.min(score, 100);
    return analysis;
  }
}
