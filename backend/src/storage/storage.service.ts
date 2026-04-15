import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  readonly uploadsPath: string;

  constructor(private readonly config: ConfigService) {
    this.uploadsPath = config.get('UPLOADS_PATH', path.join(process.cwd(), 'uploads'));
  }

  async onModuleInit() {
    await this.ensureDirectories();
  }

  private async ensureDirectories() {
    const dirs = ['projects', 'apks', 'qr', 'keystores', 'tmp'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.uploadsPath, dir), { recursive: true });
    }
  }

  async createProjectDir(projectId: string): Promise<string> {
    const dir = path.join(this.uploadsPath, 'projects', projectId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async saveFile(filePath: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    const stat = await fs.stat(filePath);
    return stat.size;
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath).catch(() => {});
  }

  async deleteDir(dirPath: string): Promise<void> {
    await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
  }

  getApkPath(buildId: string, ext = '.apk'): string {
    return path.join(this.uploadsPath, 'apks', `${buildId}${ext}`);
  }


  getProjectDir(projectId: string): string {
    return path.join(this.uploadsPath, 'projects', projectId);
  }
}
