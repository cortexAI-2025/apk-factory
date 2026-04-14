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

    const buildId = build.id;
    const apkPath = this.storage.getApkPath(buildId);

    const exists = await this.storage.fileExists(apkPath);
    if (!exists) {
      throw new NotFoundException("APK file not found on server");
    }

    res.download(
      apkPath,
      `${build.project?.name || "app"}-${build.buildType.toLowerCase()}.apk`,
    );
  }
}
