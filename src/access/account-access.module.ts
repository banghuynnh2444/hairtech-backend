import { Global, Module } from '@nestjs/common';
import { AccountAccessService } from './account-access.service';
@Global()
@Module({ providers: [AccountAccessService], exports: [AccountAccessService] })
export class AccountAccessModule {}
