import { Module } from "@nestjs/common";
import { DownloadController } from "./download.controller";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [StorageModule],
  controllers: [DownloadController],
})
export class DownloadModule {}
