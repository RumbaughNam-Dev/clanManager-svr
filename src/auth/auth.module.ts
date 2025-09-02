import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma.service';

// 전략 파일이 src/strategies/jwt.strategy.ts 에 있다면 경로는 아래처럼
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}), // 시크릿/만료는 TokensService 또는 전략에서 처리
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    PrismaService,  // ✅ 추가
    JwtStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}