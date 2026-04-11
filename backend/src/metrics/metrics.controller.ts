import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('stats')
  @ApiOperation({ summary: "Get user's build statistics" })
  stats(@Req() req: any) {
    return this.metrics.getStats(req.user.id);
  }

  @Get('feed')
  @ApiOperation({ summary: 'Get recent builds feed' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  feed(@Req() req: any, @Query('limit') limit?: string) {
    return this.metrics.getLiveFeed(req.user.id, limit ? parseInt(limit) : 20);
  }

  @Get('chart')
  @ApiOperation({ summary: 'Get build trend chart data' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  chart(@Req() req: any, @Query('days') days?: string) {
    return this.metrics.getChartData(req.user.id, days ? parseInt(days) : 30);
  }
}
