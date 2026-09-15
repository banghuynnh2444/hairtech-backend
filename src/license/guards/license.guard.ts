import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new UnauthorizedException('Không có quyền truy cập');
    }

    const adminClient = this.supabase.getAdminClient();

    // 1. Kiểm tra Single Active Session trong Database
    const { data: session, error: sessionError } = await adminClient
      .from('active_sessions')
      .select('session_token_hash')
      .eq('user_id', user.sub)
      .maybeSingle();

    if (sessionError || !session || session.session_token_hash !== user.sessionTokenHash) {
      throw new UnauthorizedException({
        code: 'SESSION_TERMINATED',
        message: 'Tài khoản của bạn vừa đăng nhập ở một thiết bị khác.',
      });
    }

    // 2. Kiểm tra trạng thái gói thuê bao
    const { data: subscription, error: subError } = await adminClient
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', user.sub)
      .maybeSingle();

    if (subError || !subscription) {
      throw new ForbiddenException({
        code: 'NO_SUBSCRIPTION',
        message: 'Không tìm thấy thông tin gói thuê bao.',
      });
    }

    const isExpired = new Date(subscription.current_period_end) < new Date();
    if (subscription.status !== 'active' || isExpired) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Gói cước đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.',
      });
    }

    return true;
  }
}