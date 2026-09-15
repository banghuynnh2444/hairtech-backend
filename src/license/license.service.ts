import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';

export class HeartbeatDto {
  deviceFingerprint: string;
}

@Injectable()
export class LicenseService {
  private readonly signingKey: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    const signingKey = this.configService.get<string>('LICENSE_SIGNING_KEY')?.trim();
    if (!signingKey || signingKey === 'hairtech_offline_license_secret_key_32bytes_min!') {
      throw new Error('Thiếu LICENSE_SIGNING_KEY riêng trong cấu hình backend.');
    }
    this.signingKey = signingKey;
  }

  async processHeartbeat(userId: string, sessionTokenHash: string, deviceFingerprint: string) {
    if (typeof deviceFingerprint !== 'string' || !deviceFingerprint.trim()) {
      throw new UnauthorizedException('Thiếu mã định danh thiết bị.');
    }
    const adminClient = this.supabase.getAdminClient();

    const { data: session, error } = await adminClient
      .from('active_sessions')
      .update({ last_heartbeat: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('session_token_hash', sessionTokenHash)
      .select('id, device_id')
      .maybeSingle();

    if (error || !session) {
      throw new UnauthorizedException({
        code: 'SESSION_TERMINATED',
        message: 'Phiên làm việc đã bị hủy từ máy khác.',
      });
    }

    const { data: device, error: deviceError } = await adminClient
      .from('devices').select('id')
      .eq('id', session.device_id).eq('user_id', userId)
      .eq('device_fingerprint', deviceFingerprint).maybeSingle();
    if (deviceError || !device) {
      throw new UnauthorizedException('Thiết bị không khớp phiên đăng nhập.');
    }

    const offlinePayload = {
      sub: userId,
      fp: deviceFingerprint,
      validUntil: Math.floor(Date.now() / 1000) + 72 * 3600,
      nonce: crypto.randomBytes(16).toString('hex'),
    };

    const serialized = JSON.stringify(offlinePayload);
    const signature = crypto
      .createHmac('sha256', this.signingKey)
      .update(serialized)
      .digest('base64url');

    return {
      status: 'healthy',
      offlineLicense: `${Buffer.from(serialized).toString('base64url')}.${signature}`,
      expiresAt: offlinePayload.validUntil,
    };
  }
}