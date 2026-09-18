import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user || !user.sub) {
      throw new UnauthorizedException('Phiên làm việc không hợp lệ.');
    }

    const adminEmailsConfig =
      this.configService.get<string>('ADMIN_EMAILS') || '';
    const adminEmails = adminEmailsConfig
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = (user.email || '').trim().toLowerCase();
    if (userEmail && adminEmails.includes(userEmail)) {
      req.user.isAdmin = true;
      return true;
    }

    const { data: profile, error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .select('role')
      .eq('id', user.sub)
      .maybeSingle();

    if (error || !profile) {
      throw new ForbiddenException('Không thể xác thực vai trò quản trị viên.');
    }

    if (profile.role === 'admin' || profile.role === 'super_admin') {
      req.user.isAdmin = true;
      return true;
    }

    throw new ForbiddenException('Chỉ quản trị viên mới có quyền truy cập tính năng này.');
  }
}
