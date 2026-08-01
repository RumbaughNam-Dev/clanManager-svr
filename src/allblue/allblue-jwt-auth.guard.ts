import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';

@Injectable()
export class AllblueJwtAuthGuard implements CanActivate {
  private jwtSecret: string;

  constructor(private config: ConfigService) {
    this.jwtSecret = this.config.get<string>('JWT_SECRET', 'dev-allblue-secret');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('토큰이 필요합니다');
    }

    try {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, this.jwtSecret);
      return true;
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다');
    }
  }
}
