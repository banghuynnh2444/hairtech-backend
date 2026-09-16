import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { LicenseModule } from './license/license.module';
import { ClientsModule } from './clients/clients.module';
import { DiagramsModule } from './diagrams/diagrams.module';
import { AccountAccessModule } from './access/account-access.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    AccountAccessModule,
    AuthModule,
    LicenseModule,
    ClientsModule,
    DiagramsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
