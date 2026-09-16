import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { requiredJwtSecret } from './jwt-config';

export interface JwtPayload {
  sub: string;
  email: string;
  deviceId: string;
  sessionTokenHash: string;
  tokenType: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requiredJwtSecret(configService),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub || payload.tokenType !== 'access') {
      throw new UnauthorizedException('Token không hợp lệ');
    }
    return payload; // Gắn dữ liệu giải mã vào req.user
  }
}
