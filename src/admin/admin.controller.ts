import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminUserQueryDto, AssignSubscriptionDto } from './admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  async listUsers(@Query() query: AdminUserQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Post('users/:id/approve')
  async approveUser(@Param('id') id: string) {
    return this.adminService.approveUser(id);
  }

  @Post('users/:id/revoke')
  async revokeUser(@Param('id') id: string) {
    return this.adminService.revokeUser(id);
  }

  @Post('users/:id/subscription')
  async assignSubscription(
    @Param('id') id: string,
    @Body() dto: AssignSubscriptionDto,
  ) {
    return this.adminService.assignSubscription(id, dto);
  }

  @Post('users/:id/reset-device')
  async resetDevice(@Param('id') id: string) {
    return this.adminService.resetDevice(id);
  }
}
