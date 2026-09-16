import type { NestExpressApplication } from '@nestjs/platform-express';
import { rateLimit } from 'express-rate-limit';

const tooManyRequests = 'Bạn thao tác quá nhanh. Vui lòng chờ một lúc rồi thử lại.';

function limiter(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response, _next, options) {
      response.status(options.statusCode).json({
        statusCode: options.statusCode,
        error: 'Too Many Requests',
        message: tooManyRequests,
      });
    },
  });
}

export function configureHttpSecurity(app: NestExpressApplication) {
  // Render terminates TLS in one proxy before the Node process. Trusting one hop
  // lets the limiter use the real client IP without trusting arbitrary headers.
  app.set('trust proxy', 1);

  app.use('/auth/login', limiter(10 * 60_000, 10));
  app.use('/auth/register', limiter(60 * 60_000, 5));
  app.use('/auth/forgot-password', limiter(60 * 60_000, 5));
  app.use('/auth/reset-password', limiter(60 * 60_000, 8));
  app.use('/auth/refresh', limiter(15 * 60_000, 60));
  app.use('/auth/session', limiter(15 * 60_000, 120));
  app.use('/license/heartbeat', limiter(15 * 60_000, 120));
  app.use(limiter(15 * 60_000, 300));
}
