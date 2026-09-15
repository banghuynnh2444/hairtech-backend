import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseGuard } from './guards/license.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [LicenseController],
  providers: [LicenseService, LicenseGuard],
  exports: [LicenseService, LicenseGuard],
})
export class LicenseModule {}