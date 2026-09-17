import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ClientsModule } from '../clients/clients.module';
import { LicenseModule } from '../license/license.module';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    LicenseModule,
    ClientsModule,
  ],
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
