import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AccountAccessService } from '../../access/account-access.service';
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly access: AccountAccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    if (!user?.sub) throw new UnauthorizedException('Không có quyền truy cập');
    await this.access.verify(user.sub, user.sessionTokenHash, user.deviceId);
    return true;
  }
}
