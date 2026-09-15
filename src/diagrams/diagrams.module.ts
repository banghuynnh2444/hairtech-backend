import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DiagramsService } from './diagrams.service';
import { DiagramsController } from './diagrams.controller';
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    LicenseModule,
  ],
  controllers: [DiagramsController],
  providers: [DiagramsService],
  exports: [DiagramsService],
})
export class DiagramsModule {}