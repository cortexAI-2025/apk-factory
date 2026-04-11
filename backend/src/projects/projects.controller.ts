import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ProjectsService } from './projects.service';
import { CreateProjectFromUrlDto } from './dto/create-project.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a ZIP project' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
      fileFilter: (_, file, cb) => {
        if (!file.originalname.match(/\.(zip)$/i)) {
          return cb(new Error('Only ZIP files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadZip(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
    @Body('description') description?: string,
  ) {
    return this.projectsService.createFromZip(userId, file, name, description);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import project from GitHub URL' })
  async importFromUrl(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProjectFromUrlDto,
  ) {
    return this.projectsService.createFromUrl(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all projects' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.projectsService.findAll(userId, page, Math.min(limit, 50));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details' })
  async findOne(
    @CurrentUser('id') userId: string,
    @Param('id') projectId: string,
  ) {
    return this.projectsService.findOne(userId, projectId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project' })
  async delete(
    @CurrentUser('id') userId: string,
    @Param('id') projectId: string,
  ) {
    return this.projectsService.delete(userId, projectId);
  }
}
