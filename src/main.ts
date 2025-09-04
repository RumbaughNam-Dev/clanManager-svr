// src/main.ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, NestApplicationOptions, ValidationPipe } from '@nestjs/common';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor';
import * as fs from 'fs';
import * as path from 'path';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

function bool(v?: string) {
  return v === '1' || /^true$/i.test(v ?? '');
}

function readIfExists(p?: string) {
  if (!p) return undefined;
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return fs.existsSync(abs) ? fs.readFileSync(abs) : undefined;
}

async function bootstrap() {
  const HTTPS = bool(process.env.HTTPS); // HTTPS=1 또는 true 면 TLS 사용
  const PORT = Number(process.env.PORT ?? (HTTPS ? 443 : 3000));
  const HOST = process.env.HOST ?? '0.0.0.0';

  const httpsOptions = HTTPS
    ? {
        key: readIfExists(process.env.SSL_KEY_PATH),
        cert: readIfExists(process.env.SSL_CERT_PATH),
        ca: readIfExists(process.env.SSL_CA_PATH),
      }
    : undefined;

  if (HTTPS && (!httpsOptions?.key || !httpsOptions?.cert)) {
    console.error(
      '[BOOT] HTTPS가 활성화되어 있지만 키/인증서 파일을 읽을 수 없습니다.\n' +
        '       SSL_KEY_PATH / SSL_CERT_PATH / (선택) SSL_CA_PATH 환경변수를 확인하세요.'
    );
    process.exit(1);
  }

  // ✅ 여기서 옵션을 합쳐서 전달
  const appOptions: NestApplicationOptions = {
    httpsOptions,
    bufferLogs: true,                   // 로그 버퍼링
    logger: ['error', 'warn', 'log'],   // 필요하면 'debug','verbose' 추가
  };

  const app = await NestFactory.create(
    AppModule,
    appOptions
  );

  // ✅ 요청 로그 출력 미들웨어
  app.use((req, _res, next) => {
    console.log(`[REQ] ${req.method} ${req.url} x-orig=${req.headers['x-orig-method']}`);
    next();
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS
  const defaultOrigins = [
    'https://rumbaugh.co.kr',
    'http://rumbaugh.co.kr',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const origins = (process.env.FRONT_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowOrigins = origins.length > 0 ? origins : defaultOrigins;

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, allowOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // ⬇️ 여기에 커스텀 헤더 추가
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-From-HttpWrapper',
      'X-Orig-Method',
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());

  await app.listen(PORT, HOST);

  const scheme = HTTPS ? 'https' : 'http';
  console.log(`✅ API on ${scheme}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  Logger.log(`✅ API on ${scheme}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`, 'Bootstrap');
  console.log(`   CORS allowed origins: ${allowOrigins.join(', ') || '(none)'}`);
}
bootstrap();