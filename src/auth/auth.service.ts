import {
  Injectable, UnauthorizedException, BadRequestException,
  InternalServerErrorException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';
import { AccountAccessService, throwAccessError } from '../access/account-access.service';
import type { JwtPayload } from './jwt.strategy';
import { LoginDto, RegisterDto } from './auth.dto';

export { LoginDto, RegisterDto } from './auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly access: AccountAccessService,
    private readonly configService: ConfigService,
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
    const redirectTo = this.getPasswordResetRedirectUrl();
    const { error } = await this.supabase.createAuthClient().auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo },
    );
    if (error) {
      this.logger.warn(`Yêu cầu khôi phục mật khẩu bị từ chối: ${error.code ?? 'unknown'}`);
      throw new BadRequestException('Chưa thể gửi email khôi phục. Vui lòng chờ một lúc rồi thử lại.');
    }
    return {
      success: true,
      message: 'Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi trong ít phút.',
    };
  }

  async resetPassword(accessToken: string, password: string) {
    const authClient = this.supabase.createAuthClient();
    const { data, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !data.user) {
      throw new BadRequestException('Liên kết khôi phục không hợp lệ hoặc đã hết hạn.');
    }

    const admin = this.supabase.getAdminClient();
    const { error: passwordError } = await admin.auth.admin.updateUserById(data.user.id, {
      password,
    });
    if (passwordError) {
      this.logger.warn(`Không thể cập nhật mật khẩu cho user ${data.user.id}: ${passwordError.code ?? 'unknown'}`);
      throw new BadRequestException('Chưa thể cập nhật mật khẩu. Vui lòng yêu cầu một liên kết mới.');
    }

    // Password recovery invalidates the HairTech session immediately. The device
    // remains bound, so the owner can sign in again without admin intervention.
    const { error: sessionError } = await admin
      .from('active_sessions')
      .delete()
      .eq('user_id', data.user.id);
    if (sessionError) {
      this.logger.warn(`Đã đổi mật khẩu nhưng chưa dọn được phiên app của user ${data.user.id}.`);
    }
    return { success: true, message: 'Mật khẩu đã được cập nhật. Bạn có thể quay lại HairTech để đăng nhập.' };
  }

  private getPasswordResetRedirectUrl(): string {
    const configured = this.configService.get<string>('PASSWORD_RESET_REDIRECT_URL')?.trim();
    if (!configured) {
      throw new InternalServerErrorException('Máy chủ chưa cấu hình trang khôi phục mật khẩu.');
    }
    try {
      const url = new URL(configured);
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))) {
        throw new Error('Unsafe protocol');
      }
      url.hash = '';
      return url.toString();
    } catch {
      throw new InternalServerErrorException('PASSWORD_RESET_REDIRECT_URL không hợp lệ.');
    }
  }

  async login(dto: LoginDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Dữ liệu đăng nhập không hợp lệ.');
    }
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

    const claims = { sub: userId, email: authData.user.email, deviceId, sessionTokenHash };
    return {
      accessToken: this.jwtService.sign({ ...claims, tokenType: 'access' }),
      refreshToken: this.jwtService.sign({ ...claims, tokenType: 'refresh' }, { expiresIn: '30d' }),
      user: { id: userId, email: authData.user.email },
    };
  }

  async refresh(authorization: string | undefined, fingerprint: unknown) {
    if (typeof fingerprint !== 'string' || !fingerprint.trim() || fingerprint.length > 256) {
      throw new BadRequestException('Thiếu mã định danh thiết bị.');
    }
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Thiếu refresh token.');

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
      if (payload.tokenType !== 'refresh' || !payload.sub || !payload.sessionTokenHash || !payload.deviceId) {
        throw new Error('Invalid refresh token');
      }
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn.');
    }

    await this.access.verify(payload.sub, payload.sessionTokenHash, payload.deviceId, fingerprint.trim(), true);
    return {
      accessToken: this.jwtService.sign({
        sub: payload.sub,
        email: payload.email,
        deviceId: payload.deviceId,
        sessionTokenHash: payload.sessionTokenHash,
        tokenType: 'access',
      }),
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
