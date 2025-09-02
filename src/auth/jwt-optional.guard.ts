// src/auth/jwt-optional.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtOptionalAuthGuard extends AuthGuard('jwt') {
  // 토큰이 없거나 검증 실패면 user 없이 통과, 있으면 user 세팅
  handleRequest(err: any, user: any) {
    if (err) return null;
    return user || null;
  }
}