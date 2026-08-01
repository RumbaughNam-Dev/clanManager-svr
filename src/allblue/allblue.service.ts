import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';

@Injectable()
export class AllblueService {
  private jwtSecret: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.jwtSecret = this.config.get<string>('JWT_SECRET', 'dev-allblue-secret');
  }

  private async logHistory(userId: BigInt, result: string, ip?: string) {
    await this.prisma.allblue_login_history.create({
      data: { userId: userId as bigint, result, ipAddress: ip },
    });
  }

  async login(userId: string, password: string, ip?: string) {
    const user = await this.prisma.allblue_user.findUnique({
      where: { userId },
    });

    if (!user) {
      return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다' };
    }

    // status 분기
    if (user.status !== 'approved') {
      await this.logHistory(user.id, 'fail_status', ip);
      const statusMessages: Record<string, string> = {
        pending: '승인 대기 중인 계정입니다',
        suspended: '이용이 제한된 계정입니다',
        rejected: '승인이 거부된 계정입니다',
      };
      return {
        success: false,
        message: statusMessages[user.status] ?? '이용할 수 없는 계정입니다',
      };
    }

    // 비밀번호 비교
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await this.logHistory(user.id, 'fail_password', ip);
      return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다' };
    }

    // 중복 로그인 차단
    if (user.refreshToken) {
      await this.logHistory(user.id, 'fail_duplicate', ip);
      return {
        success: false,
        message: '다른 기기에서 이미 로그인되어 있습니다. 기존 기기에서 로그아웃 후 다시 시도해주세요.',
      };
    }

    await this.logHistory(user.id, 'success', ip);

    // 토큰 생성
    const payload = {
      sub: String(user.id),
      userId: user.userId,
      userType: user.userType,
    };

    const accessToken = jwt.sign(payload, this.jwtSecret as Secret, {
      expiresIn: '1h' as unknown as SignOptions['expiresIn'],
    });
    const refreshToken = jwt.sign(
      { sub: String(user.id) },
      this.jwtSecret as Secret,
      { expiresIn: '7d' as unknown as SignOptions['expiresIn'] },
    );

    // DB 업데이트
    await this.prisma.allblue_user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        lastLoginAt: new Date(),
      },
    });

    return {
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: Number(user.id),
          userId: user.userId,
          userName: user.userName,
          userType: user.userType,
        },
      },
    };
  }

  async logout(sub: string) {
    await this.prisma.allblue_user.update({
      where: { id: BigInt(sub) },
      data: { refreshToken: null },
    });
    return { success: true };
  }

  async refreshToken(refreshToken: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, this.jwtSecret);
    } catch {
      return { success: false, message: '세션이 만료되었습니다. 다시 로그인해주세요.' };
    }

    const user = await this.prisma.allblue_user.findUnique({
      where: { id: BigInt(decoded.sub) },
    });

    if (!user || user.refreshToken !== refreshToken) {
      return { success: false, message: '세션이 만료되었습니다. 다시 로그인해주세요.' };
    }

    const payload = {
      sub: String(user.id),
      userId: user.userId,
      userType: user.userType,
    };

    const accessToken = jwt.sign(payload, this.jwtSecret as Secret, {
      expiresIn: '1h' as unknown as SignOptions['expiresIn'],
    });

    return { success: true, data: { accessToken } };
  }
}
