// src/main.ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor';
import * as fs from 'fs';
import * as path from 'path';

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

  // HTTPS 옵션 (키/인증서 경로는 .env로 주입)
  const httpsOptions = HTTPS
    ? {
        key: readIfExists(process.env.SSL_KEY_PATH),     // 예: /home/ubuntu/tomcat8/cert/rumbaugh_co_kr_rsa.key
        cert: readIfExists(process.env.SSL_CERT_PATH),   // 예: /home/ubuntu/tomcat8/cert/rumbaugh_co_kr.crt
        ca: readIfExists(process.env.SSL_CA_PATH),       // 예: /home/ubuntu/tomcat8/cert/ChainCA.crt 또는 bundle.pem
      }
    : undefined;

  // HTTPS 켜줬는데 파일을 못 읽으면 바로 알림
  if (HTTPS && (!httpsOptions?.key || !httpsOptions?.cert)) {
    console.error(
      '[BOOT] HTTPS가 활성화되어 있지만 키/인증서 파일을 읽을 수 없습니다.\n' +
        '       SSL_KEY_PATH / SSL_CERT_PATH / (선택) SSL_CA_PATH 환경변수를 확인하세요.'
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { httpsOptions });

  // CORS
  // - origin은 "스킴+호스트(+포트)"까지만 의미가 있습니다. (경로 붙여도 무시)
  // - 필요시 FRONT_ORIGINS="https://rumbaugh.co.kr,http://localhost:5173" 처럼 콤마구분으로 덮어쓰기 가능
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
      // 서버-서버(서버사이드) 호출은 origin이 undefined일 수 있음 → 허용
      if (!origin) return cb(null, true);
      cb(null, allowOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  console.log(`   CORS allowed origins: ${allowOrigins.join(', ') || '(none)'}`);
}
bootstrap();