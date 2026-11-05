import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectSourceType } from '@prisma/client';

export class CreateProjectFromUrlDto {
  @ApiPropertyOptional({ example: 'My Android App', description: 'Defaults to the repository name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    example: 'https://github.com/user/my-android-app',
    description: 'GitHub repository, /tree/<branch>/<folder> URL, or GitHub ZIP link',
  })
  @IsString()
  @MaxLength(400)
  sourceUrl: string;

  @ApiPropertyOptional({ enum: ProjectSourceType, example: ProjectSourceType.GITHUB_URL })
  @IsOptional()
  @IsEnum([ProjectSourceType.GITHUB_URL, ProjectSourceType.GITHUB_OAUTH])
  sourceType?: ProjectSourceType;
}
