import type { INestApplication } from '@nestjs/common';

const DESKTOP_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
];

export function resolveCorsOrigins(configured?: string): Set<string> {
  const origins = new Set(DESKTOP_ORIGINS);
  for (const raw of configured?.split(',') ?? []) {
    const value = raw.trim().replace(/\/$/, '');
    if (!value) continue;
    if (value === '*') throw new Error('CORS_ORIGINS không được dùng wildcard *.');
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') {
        throw new Error('Invalid origin');
      }
      origins.add(url.origin);
    } catch {
      throw new Error(`CORS_ORIGINS chứa origin không hợp lệ: ${value}`);
    }
  }
  return origins;
}

export function configureCors(app: INestApplication, configured?: string) {
  const allowed = resolveCorsOrigins(configured);
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || allowed.has(origin.replace(/\/$/, ''))) return callback(null, true);
      return callback(new Error('Origin không được HairTech cho phép.'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 86_400,
  });
}
