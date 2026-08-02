import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllbluePrismaService } from '../allblue-prisma.service';
import * as bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';

@Injectable()
export class AllblueService {
  private jwtSecret: string;

  constructor(
    private prisma: AllbluePrismaService,
    private config: ConfigService,
  ) {
    this.jwtSecret = this.config.get<string>('JWT_SECRET', 'dev-allblue-secret');
  }

  private async logHistory(userId: number, result: string, ip?: string) {
    await this.prisma.login_history.create({
      data: { userId, result, ipAddress: ip },
    });
  }

  async login(userId: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
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
    const isMatch = await bcrypt.compare(password, user.password);
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
    await this.prisma.user.update({
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
          id: user.id,
          userId: user.userId,
          userName: user.userName,
          userType: user.userType,
        },
      },
    };
  }

  async getFormItems(formId: string, instructorId: number) {
    if (!formId) {
      return { success: false, message: 'formId는 필수입니다' };
    }

    // 강사 커스텀 항목 조회
    const customItems = await this.prisma.form_item.findMany({
      where: { formId, instructorId },
      orderBy: { seq: 'asc' },
      select: { id: true, formId: true, seq: true, content: true, itemType: true },
    });

    if (customItems.length > 0) {
      return { success: true, data: customItems };
    }

    // 기본 템플릿 반환
    const defaultItems = await this.prisma.form_item.findMany({
      where: { formId, instructorId: null },
      orderBy: { seq: 'asc' },
      select: { id: true, formId: true, seq: true, content: true, itemType: true },
    });

    return { success: true, data: defaultItems };
  }

  async logout(sub: string) {
    await this.prisma.user.update({
      where: { id: Number(sub) },
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

    const user = await this.prisma.user.findUnique({
      where: { id: Number(decoded.sub) },
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
