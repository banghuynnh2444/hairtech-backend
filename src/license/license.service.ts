import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { IsString, Length } from 'class-validator';
import { AccountAccessService } from '../access/account-access.service';

export class HeartbeatDto {
  @IsString({ message: 'Thiếu mã định danh thiết bị.' })
  @Length(1, 256, { message: 'Mã định danh thiết bị không hợp lệ.' })
  deviceFingerprint: string;
}

@Injectable()
export class LicenseService {
  private readonly privateKey: crypto.KeyObject;

  constructor(
    private readonly configService: ConfigService,
    private readonly access: AccountAccessService,
  ) {
    const encodedKey = this.configService.get<string>('LICENSE_PRIVATE_KEY')?.trim();
    if (!encodedKey) {
      throw new Error('Thiếu LICENSE_PRIVATE_KEY Ed25519 trong cấu hình backend.');
    }
    try {
      this.privateKey = crypto.createPrivateKey({
        key: Buffer.from(encodedKey, 'base64url'), format: 'der', type: 'pkcs8',
      });
      if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Wrong key type');
    } catch {
      throw new Error('LICENSE_PRIVATE_KEY phải là private key Ed25519 PKCS8 dạng base64url.');
    }
  }

  async processHeartbeat(userId: string, sessionTokenHash: string, deviceFingerprint: string, deviceId: string) {
    if (typeof deviceFingerprint !== 'string' || !deviceFingerprint.trim()) {
      throw new UnauthorizedException('Thiếu mã định danh thiết bị.');
    }
    const fingerprint = deviceFingerprint.trim();
    const expiry = await this.access.verify(userId, sessionTokenHash, deviceId, fingerprint, true);
    const now = Math.floor(Date.now() / 1000);
    const subscriptionExpiresAt = Math.floor(Date.parse(expiry) / 1000);

    const offlinePayload = {
      version: 1,
      sub: userId,
      deviceId,
      fp: fingerprint,
      issuedAt: now,
      validUntil: Math.min(now + 72 * 3600, subscriptionExpiresAt),
      subscriptionExpiresAt,
      nonce: crypto.randomBytes(16).toString('hex'),
    };

    const serialized = JSON.stringify(offlinePayload);
    const signature = crypto.sign(null, Buffer.from(serialized), this.privateKey).toString('base64url');

    return {
      status: 'healthy',
      offlineLicense: `${Buffer.from(serialized).toString('base64url')}.${signature}`,
      expiresAt: offlinePayload.validUntil,
    };
  }
}
