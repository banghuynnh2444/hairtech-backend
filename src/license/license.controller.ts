import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LicenseService, HeartbeatDto } from './license.service';

@Controller('license')
@UseGuards(JwtAuthGuard)
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Post('heartbeat')
  async heartbeat(@Req() req: any, @Body() body: HeartbeatDto) {
    return this.licenseService.processHeartbeat(
      req.user.sub,
      req.user.sessionTokenHash,
      body.deviceFingerprint,
      req.user.deviceId,
    );
  }
}
