import { ConfigService } from '@nestjs/config';
export function requiredJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET')?.trim();
  if (!secret || secret === 'default_secret') throw new Error('Thiếu JWT_SECRET riêng trong cấu hình backend.');
  return secret;
}
