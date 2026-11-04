import { Controller, Get, Param, NotFoundException, Res } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { Response } from "express";
import * as path from "path";

@ApiTags("download")
@Controller("download")
export class DownloadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get(":token")
  @ApiOperation({ summary: "Download APK via public link" })
  async downloadApk(@Param("token") token: string, @Res() res: Response) {
    const publicLink = `${process.env.API_BASE_URL}/api/v1/download/${token}`;

    const build = await this.prisma.build.findFirst({
      where: {
        publicLink,
        status: "SUCCESS",
      },
      include: {
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!build || !build.apkUrl) {
      throw new NotFoundException("Download link is invalid or expired");
    }

    if (build.publicLinkExpiry && new Date() > build.publicLinkExpiry) {
      throw new NotFoundException("Download link has expired");
    }

    const artifact = await this.prisma.buildArtifact.findFirst({
      where: { buildId: build.id },
      orderBy: [{ recommended: 'desc' }, { createdAt: 'asc' }],
    });
    if (!artifact || !(await this.storage.fileExists(artifact.storagePath))) {
      throw new NotFoundException("APK file not found on server");
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('application/vnd.android.package-archive');
    res.download(artifact.storagePath, artifact.fileName);
  }
}
