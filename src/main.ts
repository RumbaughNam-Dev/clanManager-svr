import 'dotenv/config'; // ← 추가
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true, // 개발 중에는 요청한 Origin을 그대로 허용
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  // ✅ BigInt 응답 직렬화 전역 적용
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0'); // <- 바인딩을 0.0.0.0으로
  console.log(`API on http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();