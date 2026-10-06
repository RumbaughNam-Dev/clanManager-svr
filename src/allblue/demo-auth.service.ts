import { HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllbluePrismaService } from '../allblue-prisma.service';
import * as bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

@Injectable()
export class DemoAuthService {
  private readonly attempts = new Map<string, { count: number; expires: number }>();

  constructor(private readonly prisma: AllbluePrismaService, private readonly config: ConfigService) {}

  async login(code: unknown, address: string) {
    const userId = this.config.get<string>('ALLBLUE_DEMO_USER_ID');
    const codeHash = this.config.get<string>('ALLBLUE_DEMO_CODE_HASH');
    const secret = this.config.get<string>('JWT_SECRET');
    if (!userId || !codeHash || !secret) {
      throw new ServiceUnavailableException('데모 체험을 준비 중입니다. 잠시 후 다시 시도해주세요.');
    }

    const now = Date.now();
    for (const [key, value] of this.attempts) {
      if (value.expires <= now) this.attempts.delete(key);
    }
    const attempt = this.attempts.get(address) ?? { count: 0, expires: now + 60_000 };
    if (attempt.count >= 10 || (!this.attempts.has(address) && this.attempts.size >= 1000)) {
      throw new HttpException('잠시 후 다시 시도해주세요.', 429);
    }
    attempt.count++;
    this.attempts.set(address, attempt);

    if (typeof code !== 'string' || code.length > 128 || !code.trim() || !(await bcrypt.compare(code.trim(), codeHash))) {
      throw new UnauthorizedException('데모 접속 코드를 확인해주세요.');
    }

    // The caller never chooses the account or permissions.
    let user = await this.prisma.user.findUnique({ where: { userId }, include: { profile: true } });
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            userId, password: await bcrypt.hash(randomUUID(), 12),
            nickname: '데모 다이버', userName: 'Demo Reviewer', userType: 'instructor', status: 'approved',
            profile: { create: { level: '5', description: '공용 데모 계정입니다. 개인정보를 입력하지 마세요.' } },
          },
          include: { profile: true },
        });
      } catch (error) {
        // Concurrent first logins must reuse the winner, never overwrite it.
        if (error?.code !== 'P2002') throw error;
        user = await this.prisma.user.findUnique({ where: { userId }, include: { profile: true } });
      }
    }
    if (!user || user.isTemporary || user.status !== 'approved' || !['user', 'instructor'].includes(user.userType) || user.profile?.level === 'A' || user.kakaoId || user.googleId || user.naverId || user.appleId) {
      throw new ServiceUnavailableException('데모 계정을 사용할 수 없습니다.');
    }
    const token = jwt.sign({ sub: String(user.id), userId: user.userId, userType: user.userType, demo: true }, secret, { expiresIn: '24h' });
    return {
      token,
      user: {
        id: String(user.id), nickname: user.nickname, name: user.userName ?? undefined,
        profileImage: user.profileImage ?? undefined, demo: true,
      },
    };
  }
}
