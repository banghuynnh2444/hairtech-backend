import type { INestApplication } from '@nestjs/common';
import { json } from 'express';

export function configureDiagramBodyParser(app: INestApplication) {
  // Register before app.init()/listen() so the default 100 KB parser does not
  // reject a valid project first. All unrelated endpoints keep their old limit.
  app.use('/diagrams', json({ limit: '5mb' }));
}
