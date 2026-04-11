import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuildType } from '@prisma/client';

export class CreateBuildDto {
  @ApiProperty({ enum: BuildType, default: BuildType.DEBUG })
  @IsEnum(BuildType)
  buildType: BuildType = BuildType.DEBUG;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoFix?: boolean = true;
}
