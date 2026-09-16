import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureDiagramBodyParser } from './diagrams/diagrams.http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Large project documents; other routes retain their default request size limit.
  configureDiagramBodyParser(app);
  
  // Cho phép kết nối từ Tauri frontend
  app.enableCors();
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
}
void bootstrap();
