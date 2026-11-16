import { IsEnum, IsIn, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuildType } from '@prisma/client';

export class CreateBuildDto {
  @ApiProperty({ enum: BuildType, default: BuildType.DEBUG })
  @IsEnum(BuildType)
  @IsIn([BuildType.DEBUG, BuildType.RELEASE])
  buildType: BuildType = BuildType.DEBUG;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoFix?: boolean = true;
}
