import { ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const messages: Record<string, string> = {
  ACCOUNT_NOT_APPROVED: 'Tài khoản của bạn đang chờ được phê duyệt.',
  PROFILE_NOT_FOUND: 'Chưa có hồ sơ tài khoản. Vui lòng liên hệ quản trị viên.',
  NO_SUBSCRIPTION: 'Tài khoản chưa có gói dịch vụ. Vui lòng liên hệ quản trị viên.',
  PAID_PLAN_REQUIRED: 'Tài khoản cần có gói dịch vụ trả phí hợp lệ để sử dụng ứng dụng.',
  SUBSCRIPTION_INACTIVE: 'Gói dịch vụ hiện không hoạt động.',
  SUBSCRIPTION_EXPIRED: 'Gói dịch vụ đã hết hạn. Vui lòng gia hạn để tiếp tục.',
  SUBSCRIPTION_NOT_STARTED: 'Gói dịch vụ chưa đến ngày bắt đầu.',
  DEVICE_LIMIT_EXCEEDED: 'Tài khoản đã liên kết với một thiết bị khác. Vui lòng liên hệ quản trị viên để đổi thiết bị.',
  DEVICE_NOT_ACTIVE: 'Thiết bị không còn được phép sử dụng tài khoản này.',
  SESSION_TERMINATED: 'Phiên làm việc đã kết thúc. Vui lòng đăng nhập lại.',
};
export function throwAccessError(error: { message?: string } | null): never {
  const code = error?.message || '';
  if (messages[code]) {
    const Exception = ['DEVICE_NOT_ACTIVE','SESSION_TERMINATED'].includes(code) ? UnauthorizedException : ForbiddenException;
    throw new Exception({ code, message: messages[code] });
  }
  throw new InternalServerErrorException('Không thể kiểm tra quyền sử dụng. Vui lòng thử lại hoặc liên hệ hỗ trợ.');
}
@Injectable()
export class AccountAccessService {
  constructor(private readonly supabase: SupabaseService) {}
  async verify(userId: string, hash: string, deviceId: string, fingerprint?: string, touch = false): Promise<string> {
    if (!userId || !hash || !deviceId) throwAccessError({ message: 'SESSION_TERMINATED' });
    const { data, error } = await this.supabase.getAdminClient().rpc('verify_account_session', {
      p_user_id: userId, p_session_hash: hash, p_device_id: deviceId,
      p_fingerprint: fingerprint ?? null, p_touch: touch,
    });
    if (error) throwAccessError(error);
    if (typeof data !== 'string' || !Number.isFinite(Date.parse(data))) throwAccessError(null);
    return data;
  }
}
