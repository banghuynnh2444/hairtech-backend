import type { INestApplication } from '@nestjs/common';
import { json } from 'express';

export function configureHttpBodyParsers(app: INestApplication) {
  // Parse large project documents first, then apply the normal limit everywhere
  // else. Nest's built-in parser is disabled so both limits are deterministic.
  app.use('/diagrams', json({ limit: '5mb' }));
  app.use(json({ limit: '100kb' }));
}
