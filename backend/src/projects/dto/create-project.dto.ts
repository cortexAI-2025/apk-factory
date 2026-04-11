import { IsString, IsEnum, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectSourceType } from '@prisma/client';

export class CreateProjectFromUrlDto {
  @ApiProperty({ example: 'My Android App' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 'https://github.com/user/my-android-app' })
  @IsUrl()
  sourceUrl: string;

  @ApiProperty({ enum: ProjectSourceType, example: ProjectSourceType.GITHUB_URL })
  @IsEnum([ProjectSourceType.GITHUB_URL, ProjectSourceType.GITHUB_OAUTH])
  sourceType: ProjectSourceType;
}
