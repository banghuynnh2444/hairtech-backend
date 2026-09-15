import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    LicenseModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}