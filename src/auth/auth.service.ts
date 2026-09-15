import {
  Injectable, UnauthorizedException, BadRequestException,
  InternalServerErrorException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';

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
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwtService: JwtService,
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
      // The SQL function creates both rows in one database transaction.
      const { error } = await this.supabase.getAdminClient().rpc('initialize_trial_account', {
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
      throw new InternalServerErrorException('Chưa thể khởi tạo hồ sơ và gói dùng thử. Vui lòng liên hệ hỗ trợ.');
    }
    return { success: true, message: 'Đăng ký thành công! Bạn có 14 ngày trải nghiệm.' };
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
    const authClient = this.supabase.createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: dto.email, password: dto.password,
    });
    if (authError || !authData.user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const userId = authData.user.id;
    const admin = this.supabase.getAdminClient();
    // Row locking in SQL makes counting + inserting atomic across backend processes.
    const { data: deviceId, error: deviceError } = await admin.rpc('register_device', {
      p_user_id: userId,
      p_fingerprint: dto.deviceFingerprint.trim(),
      p_device_name: dto.deviceName,
      p_platform: dto.platform,
    });
    if (deviceError?.message === 'DEVICE_LIMIT_EXCEEDED') {
      throw new UnauthorizedException({
        code: 'DEVICE_LIMIT_EXCEEDED', message: 'Tài khoản đã đạt giới hạn tối đa 2 thiết bị.',
      });
    }
    if (deviceError || !deviceId) {
      throw new InternalServerErrorException('Không thể kiểm tra hoặc đăng ký thiết bị. Vui lòng liên hệ hỗ trợ.');
    }

    const sessionTokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
    const { error: sessionError } = await admin.from('active_sessions').upsert({
      user_id: userId,
      device_id: deviceId,
      session_token_hash: sessionTokenHash,
      client_version: '2.0.0',
      last_heartbeat: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (sessionError) {
      throw new InternalServerErrorException('Không thể khởi tạo phiên làm việc. Vui lòng liên hệ hỗ trợ.');
    }

    return {
      accessToken: this.jwtService.sign({ sub: userId, email: authData.user.email, deviceId, sessionTokenHash }),
      user: { id: userId, email: authData.user.email },
    };
  }
}
