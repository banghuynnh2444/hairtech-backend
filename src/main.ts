import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureHttpBodyParsers } from './diagrams/diagrams.http';
import { configureCors } from './security/cors';
import { configureHttpSecurity } from './security/http-security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureCors(app, process.env.CORS_ORIGINS);
  configureHttpSecurity(app);
  configureHttpBodyParsers(app);
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: false,
    stopAtFirstError: true,
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
void bootstrap();
