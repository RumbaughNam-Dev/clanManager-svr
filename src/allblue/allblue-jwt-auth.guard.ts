import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { AllbluePrismaService } from '../allblue-prisma.service';

@Injectable()
export class AllblueJwtAuthGuard implements CanActivate {
  private jwtSecret: string;

  constructor(private config: ConfigService, private prisma: AllbluePrismaService) {
    this.jwtSecret = this.config.get<string>('JWT_SECRET', 'dev-allblue-secret');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('토큰이 필요합니다');
    }

    try {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, this.jwtSecret);
      const user = await this.prisma.user.findUnique({
        where: { userId: req.user.userId }, select: { id: true, status: true, isTemporary: true },
      });
      if (!user || String(user.id) !== req.user.sub || user.status !== 'approved' || user.isTemporary) {
        throw new UnauthorizedException('사용할 수 없는 세션입니다');
      }
      return true;
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다');
    }
  }
}
