import {
  Injectable, UnauthorizedException, BadRequestException,
  InternalServerErrorException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';
import { AccountAccessService, throwAccessError } from '../access/account-access.service';

export class RegisterDto {
  email: string;
  password: string;
  salonName: string;
}

export class LoginDto {
  email: string;
  password: string;
  deviceFingerprint: string;
  deviceName: string;
  platform: string;
  clientVersion?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly access: AccountAccessService,
  ) {}

  async register(dto: RegisterDto) {
    const authClient = this.supabase.createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.admin.createUser({
      email: dto.email, password: dto.password, email_confirm: true,
    });
    if (authError || !authData.user) {
      throw new BadRequestException(authError?.message || 'Không thể tạo tài khoản');
    }

    const userId = authData.user.id;
    try {
      // Registration creates a pending profile only; no entitlement is provisioned.
      const { error } = await this.supabase.getAdminClient().rpc('initialize_account', {
        p_user_id: userId, p_email: dto.email, p_full_name: dto.salonName,
      });
      if (error) throw error;
    } catch {
      // Compensate only the Auth user created by this registration request.
      try {
        const { error } = await authClient.auth.admin.deleteUser(userId);
        if (error) throw error;
      } catch {
        this.logger.error('Không thể hoàn tác Auth user sau đăng ký lỗi: ' + userId);
      }
      throw new InternalServerErrorException('Chưa thể khởi tạo hồ sơ tài khoản. Vui lòng liên hệ hỗ trợ.');
    }
    return { success: true, message: 'Đăng ký thành công. Tài khoản cần được quản trị viên phê duyệt và cấp gói dịch vụ trước khi sử dụng.' };
  }

  async forgotPassword(email: string) {
    const { error } = await this.supabase.createAuthClient().auth.resetPasswordForEmail(email);
    if (error) throw new BadRequestException(error.message);
    return { success: true, message: 'Hướng dẫn khôi phục mật khẩu đã gửi về email.' };
  }

  async login(dto: LoginDto) {
    if (typeof dto.deviceFingerprint !== 'string' || !dto.deviceFingerprint.trim() || dto.deviceFingerprint.length > 256) {
      throw new BadRequestException('Không lấy được mã định danh thiết bị. Vui lòng mở ứng dụng desktop.');
    }
    for (const [value, max, optional] of [[dto.deviceName,128,false],[dto.platform,32,false],[dto.clientVersion ?? '',64,true]] as const) {
      if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
        throw new BadRequestException('Thông tin thiết bị không hợp lệ.');
      }
    }
    const authClient = this.supabase.createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: dto.email, password: dto.password,
    });
    if (authError || !authData.user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const userId = authData.user.id;
    const admin = this.supabase.getAdminClient();
    const sessionTokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
    // Approval, paid entitlement, binding and session replacement share one transaction.
    const { data: deviceId, error: sessionError } = await admin.rpc('open_account_session', {
      p_user_id: userId,
      p_fingerprint: dto.deviceFingerprint.trim(),
      p_device_name: dto.deviceName,
      p_platform: dto.platform,
      p_session_hash: sessionTokenHash,
      p_client_version: dto.clientVersion ?? null,
    });
    if (sessionError || !deviceId) throwAccessError(sessionError);

    return {
      accessToken: this.jwtService.sign({ sub: userId, email: authData.user.email, deviceId, sessionTokenHash }),
      user: { id: userId, email: authData.user.email },
    };
  }

  async session(user: { sub: string; sessionTokenHash: string; deviceId: string }, fingerprint: unknown) {
    if (typeof fingerprint !== 'string' || !fingerprint.trim() || fingerprint.length > 256) throw new BadRequestException('Thiếu mã định danh thiết bị.');
    const subscriptionExpiresAt = await this.access.verify(user.sub, user.sessionTokenHash, user.deviceId, fingerprint.trim());
    return { valid: true, subscriptionExpiresAt };
  }

  async logout(authorization: string | undefined) {
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Thiếu token đăng xuất.');
    let payload: { sub: string; sessionTokenHash: string };
    try {
      // Expired access tokens may ONLY revoke their own matching session; never grant access.
      payload = this.jwtService.verify(token, { ignoreExpiration: true });
      if (!payload.sub || !payload.sessionTokenHash) throw new Error('Invalid payload');
    } catch { throw new UnauthorizedException('Token đăng xuất không hợp lệ.'); }
    const { error } = await this.supabase.getAdminClient().rpc('close_account_session', {
      p_user_id: payload.sub, p_session_hash: payload.sessionTokenHash,
    });
    if (error) throw new InternalServerErrorException('Chưa thể kết thúc phiên. Vui lòng thử lại.');
    return { success: true };
  }
}
