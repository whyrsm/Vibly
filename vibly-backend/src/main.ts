import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for extension and web
  app.enableCors({
    origin: (origin, callback) => {
      // Allow Chrome extensions, localhost, and configured frontend
      if (
        !origin ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('http://localhost') ||
        origin === process.env.FRONTEND_URL
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Vibly API running on http://localhost:${port}`);
}

bootstrap();
