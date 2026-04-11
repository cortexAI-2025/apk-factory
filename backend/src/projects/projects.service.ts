import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateProjectFromUrlDto } from './dto/create-project.dto';
import { ProjectSourceType, ProjectType } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as unzipper from 'extract-zip';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { execSync } from 'child_process';

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
  ) {}

  async createFromZip(userId: string, file: Express.Multer.File, name?: string, description?: string) {
    const projectId = uuidv4();
    const projectDir = await this.storage.createProjectDir(projectId);

    // Extract zip
    const zipPath = path.join(projectDir, 'source.zip');
    await fs.writeFile(zipPath, file.buffer);

    const extractDir = path.join(projectDir, 'source');
    await fs.mkdir(extractDir, { recursive: true });

    try {
      await unzipper(zipPath, { dir: extractDir });
    } catch (err) {
      throw new BadRequestException(`Failed to extract ZIP: ${err.message}`);
    }

    // Find actual project root (handle nested zip structures)
    const projectRoot = await this.findProjectRoot(extractDir);
    const analysis = await this.analyzeProject(projectRoot);

    const projectName = name || path.basename(file.originalname, '.zip');

    const project = await this.prisma.project.create({
      data: {
        id: projectId,
        name: projectName,
        description,
        sourceType: ProjectSourceType.ZIP_UPLOAD,
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

    return project;
  }

  async createFromUrl(userId: string, dto: CreateProjectFromUrlDto) {
    const projectId = uuidv4();
    const projectDir = await this.storage.createProjectDir(projectId);

    // Clone GitHub repo
    const repoUrl = dto.sourceUrl;
    const cloneDir = path.join(projectDir, 'source');

    try {
      this.logger.log(`Cloning repo: ${repoUrl}`);
      execSync(`git clone --depth=1 "${repoUrl}" "${cloneDir}"`, {
        timeout: 120000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (err) {
      throw new BadRequestException(`Failed to clone repository: ${err.message}`);
    }

    const analysis = await this.analyzeProject(cloneDir);

    const project = await this.prisma.project.create({
      data: {
        id: projectId,
        name: dto.name,
        description: dto.description,
        sourceType: dto.sourceType,
        sourceUrl: dto.sourceUrl,
        sourcePath: cloneDir,
        projectType: analysis.projectType,
        gradleVersion: analysis.gradleVersion,
        sdkVersion: analysis.sdkVersion,
        kotlinVersion: analysis.kotlinVersion,
        compatibilityScore: analysis.compatibilityScore,
        metadata: analysis as any,
        userId,
      },
    });

    return project;
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

    // Clean up files
    if (project.sourcePath) {
      const projectDir = path.dirname(path.dirname(project.sourcePath));
      await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
    }

    await this.prisma.project.delete({ where: { id: projectId } });
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
