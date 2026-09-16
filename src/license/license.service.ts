import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AccountAccessService } from '../access/account-access.service';

export class HeartbeatDto {
  deviceFingerprint: string;
}

@Injectable()
export class LicenseService {
  private readonly signingKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly access: AccountAccessService,
  ) {
    const signingKey = this.configService.get<string>('LICENSE_SIGNING_KEY')?.trim();
    if (!signingKey || signingKey === 'hairtech_offline_license_secret_key_32bytes_min!') {
      throw new Error('Thiếu LICENSE_SIGNING_KEY riêng trong cấu hình backend.');
    }
    this.signingKey = signingKey;
  }

  async processHeartbeat(userId: string, sessionTokenHash: string, deviceFingerprint: string, deviceId: string) {
    if (typeof deviceFingerprint !== 'string' || !deviceFingerprint.trim()) {
      throw new UnauthorizedException('Thiếu mã định danh thiết bị.');
    }
    const expiry = await this.access.verify(userId, sessionTokenHash, deviceId, deviceFingerprint.trim(), true);

    const offlinePayload = {
      sub: userId,
      fp: deviceFingerprint,
      validUntil: Math.min(Math.floor(Date.now() / 1000) + 72 * 3600, Math.floor(Date.parse(expiry) / 1000)),
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
