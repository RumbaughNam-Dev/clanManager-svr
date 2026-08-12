import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllbluePrismaService } from '../allblue-prisma.service';
import * as bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AllblueS3Service } from './allblue-s3.service';

@Injectable()
export class AllblueService {
  private jwtSecret: string;

  constructor(
    private prisma: AllbluePrismaService,
    private config: ConfigService,
    private s3: AllblueS3Service,
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

  async createSubmission(formId: string, diverName: string, instructorId: number) {
    if (!formId) {
      return { success: false, message: 'formId는 필수입니다' };
    }
    if (!diverName?.trim()) {
      return { success: false, message: '다이버 이름은 필수입니다' };
    }

    const uuid = randomUUID();
    await this.prisma.form_submission.create({
      data: { uuid, instructorId, formId, diverName: diverName.trim() },
    });

    return {
      success: true,
      data: {
        uuid,
        url: `https://rumbaugh.co.kr/form/${uuid}`,
      },
    };
  }

  async getSubmissions(instructorId: number) {
    const submissions = await this.prisma.form_submission.findMany({
      where: { instructorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, uuid: true, formId: true, diverName: true, status: true, createdAt: true },
    });
    return {
      success: true,
      data: submissions.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
    };
  }

  async getSubmission(uuid: string) {
    const submission = await this.prisma.form_submission.findUnique({
      where: { uuid },
    });

    if (!submission) {
      return { success: false, message: '존재하지 않는 양식입니다' };
    }

    // 강사 커스텀 항목 우선, 없으면 기본 템플릿
    let items = await this.prisma.form_item.findMany({
      where: { formId: submission.formId, instructorId: submission.instructorId },
      orderBy: { seq: 'asc' },
      select: { seq: true, content: true, itemType: true },
    });

    if (items.length === 0) {
      items = await this.prisma.form_item.findMany({
        where: { formId: submission.formId, instructorId: null },
        orderBy: { seq: 'asc' },
        select: { seq: true, content: true, itemType: true },
      });
    }

    return {
      success: true,
      data: {
        submission: {
          uuid: submission.uuid,
          formId: submission.formId,
          diverName: submission.diverName,
          status: submission.status,
          printed: submission.printed,
          checkboxData: submission.checkboxData,
          birthDate: submission.birthDate,
          signDate: submission.signDate,
          signatureData: submission.signatureData,
          checkboxDetailData: submission.checkboxDetailData,
          guardianSignature: submission.guardianSignature,
          doctorName: submission.doctorName,
          doctorSignatureData: submission.doctorSignatureData,
          doctorDate: submission.doctorDate,
          doctorPhone: submission.doctorPhone,
          doctorAddress: submission.doctorAddress,
          doctorAddressDetail: submission.doctorAddressDetail,
          doctorChecks: submission.doctorChecks,
        },
        items,
      },
    };
  }

  async saveSubmission(uuid: string, body: any) {
    const {
      checkboxData, checkboxDetailData, birthDate, signDate, signatureData, guardianSignature,
      doctorName, doctorSignatureData, doctorDate, doctorPhone, doctorAddress, doctorAddressDetail, doctorChecks,
    } = body;

    if (!checkboxData || !birthDate?.trim() || !signDate?.trim() || !signatureData?.trim()) {
      return { success: false, message: '생년월일, 날짜, 서명을 모두 입력해주세요.' };
    }

    const submission = await this.prisma.form_submission.findUnique({ where: { uuid } });
    if (!submission) {
      return { success: false, message: '존재하지 않는 양식입니다' };
    }
    if (submission.status === 'submitted') {
      return { success: false, message: '이미 제출된 양식입니다.' };
    }

    const [signatureUrl, doctorSigUrl] = await Promise.all([
      this.s3.processSignatureData(signatureData, uuid, 'diver'),
      this.s3.processSignatureData(doctorSignatureData, uuid, 'doctor'),
    ]);

    await this.prisma.form_submission.update({
      where: { uuid },
      data: {
        checkboxData, checkboxDetailData: checkboxDetailData ?? null, birthDate, signDate, signatureData: signatureUrl,
        guardianSignature: guardianSignature ?? null,
        doctorName: doctorName ?? null, doctorSignatureData: doctorSigUrl ?? null,
        doctorDate: doctorDate ?? null, doctorPhone: doctorPhone ?? null,
        doctorAddress: doctorAddress ?? null, doctorAddressDetail: doctorAddressDetail ?? null,
        doctorChecks: doctorChecks ?? null,
        status: 'saved',
      },
    });

    return { success: true };
  }

  async submitSubmission(uuid: string, body: any) {
    const {
      checkboxData, checkboxDetailData, birthDate, signDate, signatureData, guardianSignature,
      doctorName, doctorSignatureData, doctorDate, doctorPhone, doctorAddress, doctorAddressDetail, doctorChecks,
    } = body;

    if (
      !checkboxData || !birthDate?.trim() || !signDate?.trim() || !signatureData?.trim() ||
      !doctorName?.trim() || !doctorSignatureData?.trim() || !doctorDate?.trim() ||
      !doctorPhone?.trim() || !doctorAddress?.trim() || !doctorAddressDetail?.trim()
    ) {
      return { success: false, message: '모든 항목을 입력해주세요.' };
    }

    const submission = await this.prisma.form_submission.findUnique({ where: { uuid } });
    if (!submission) {
      return { success: false, message: '존재하지 않는 양식입니다' };
    }
    if (submission.status === 'submitted') {
      return { success: false, message: '이미 제출된 양식입니다.' };
    }

    const [signatureUrl, doctorSigUrl] = await Promise.all([
      this.s3.processSignatureData(signatureData, uuid, 'diver'),
      this.s3.processSignatureData(doctorSignatureData, uuid, 'doctor'),
    ]);

    await this.prisma.form_submission.update({
      where: { uuid },
      data: {
        checkboxData, checkboxDetailData: checkboxDetailData ?? null, birthDate, signDate, signatureData: signatureUrl,
        guardianSignature: guardianSignature ?? null,
        doctorName, doctorSignatureData: doctorSigUrl, doctorDate, doctorPhone, doctorAddress, doctorAddressDetail,
        doctorChecks: doctorChecks ?? null,
        status: 'submitted',
      },
    });

    return { success: true };
  }

  async printSubmission(uuid: string) {
    const submission = await this.prisma.form_submission.findUnique({
      where: { uuid },
    });

    if (!submission) {
      return { success: false, message: '존재하지 않는 양식입니다' };
    }

    if (submission.printed === 1) {
      return { success: false, message: '이미 출력된 양식입니다.' };
    }

    await this.prisma.form_submission.update({
      where: { uuid },
      data: { printed: 1 },
    });

    return { success: true };
  }

  async registerRequest(body: any, file: Express.Multer.File) {
    const { userId, name, phone, kakaoId, instaId, isInstructor } = body;

    if (!userId?.trim() || userId.trim().length < 4) {
      return { success: false, message: '아이디는 4자 이상 입력해주세요.' };
    }
    if (!name?.trim()) {
      return { success: false, message: '이름을 입력해주세요.' };
    }
    if (isInstructor === '1' && !file) {
      return { success: false, message: '자격증 이미지를 첨부해주세요.' };
    }

    let certImageUrl: string | null = null;
    if (file) {
      const key = `instructor-certs/${Date.now()}_${file.originalname}`;
      certImageUrl = await this.s3.uploadFile(file.buffer, key, file.mimetype);
      if (!certImageUrl) {
        certImageUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      }
    }

    await this.prisma.instructor_register_request.create({
      data: {
        userId: userId.trim(),
        name: name.trim(),
        phone: phone?.trim() || null,
        kakaoId: kakaoId?.trim() || null,
        instaId: instaId?.trim() || null,
        isInstructor: isInstructor === '1' ? '1' : '0',
        certImageUrl,
      },
    });

    return { success: true };
  }

  async getRegisterRequests() {
    const requests = await this.prisma.instructor_register_request.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: requests.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    };
  }

  async updateRegisterRequestStatus(id: number, status: string) {
    await this.prisma.instructor_register_request.update({
      where: { id },
      data: { status },
    });
    return { success: true };
  }

  async authRegister(tempToken: string | null, body: any) {
    if (!tempToken) {
      return { error: 'UNAUTHORIZED', message: '임시 토큰이 필요합니다.' };
    }

    // 1. tempToken 검증
    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, this.jwtSecret);
    } catch {
      return { error: 'TOKEN_EXPIRED', message: '임시 토큰이 만료되었습니다. 다시 로그인해주세요.' };
    }

    if (decoded.type !== 'temp_signup') {
      return { error: 'INVALID_TOKEN', message: '유효하지 않은 토큰입니다.' };
    }

    // 2. 유효성 검증
    const { name, birthDate, phone, kakaoTalkId, instagramId } = body;

    if (!name?.trim()) {
      return { error: 'VALIDATION_ERROR', message: '이름을 입력해주세요.' };
    }
    if (!birthDate?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) {
      return { error: 'VALIDATION_ERROR', message: '생년월일을 YYYY-MM-DD 형식으로 입력해주세요.' };
    }
    if (!phone?.trim() && !kakaoTalkId?.trim() && !instagramId?.trim()) {
      return { error: 'VALIDATION_ERROR', message: '연락처 정보를 최소 1개 입력해주세요.' };
    }

    // 3. DB에 유저 생성
    const randomPassword = await bcrypt.hash(randomUUID(), 10);
    const user = await this.prisma.user.create({
      data: {
        userId: `kakao_${decoded.kakaoId}`,
        password: randomPassword,
        userName: name.trim(),
        email: decoded.email,
        phone: phone?.trim() || null,
        kakaoId: decoded.kakaoId,
        profileImage: decoded.profileImage,
        birthDate: birthDate.trim(),
        kakaoTalkId: kakaoTalkId?.trim() || null,
        instagramId: instagramId?.trim() || null,
        userType: 'user',
        status: 'approved',
      },
    });

    // 4. 정식 JWT 토큰 발급
    const token = jwt.sign(
      { sub: String(user.id), userId: user.userId, userType: user.userType },
      this.jwtSecret as Secret,
      { expiresIn: '7d' as unknown as SignOptions['expiresIn'] },
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.userName,
        profileImage: user.profileImage,
      },
    };
  }

  async kakaoAuthCallback(code: string) {
    if (!code) {
      return { error: true, message: '인증코드가 없습니다.' };
    }

    const kakaoClientId = this.config.get<string>('KAKAO_CLIENT_ID', 'b1b8a86fb3380ff331b52d75cb63ce82');
    const kakaoClientSecret = this.config.get<string>('KAKAO_CLIENT_SECRET', 'Kv7Nv9gKjmxjTN5a6Lhy4UBp3zSzNuzV');
    const redirectUri = this.config.get<string>('KAKAO_REDIRECT_URI', 'https://api.rumbaugh.co.kr/allblue/auth/kakao/callback');

    // 1. 카카오 토큰 교환
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: kakaoClientId,
        client_secret: kakaoClientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      return { error: true, message: '카카오 인증에 실패했습니다.' };
    }

    // 2. 카카오 사용자 정보 조회
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const kakaoUser = await userRes.json() as any;

    const kakaoId = String(kakaoUser.id);
    const email = kakaoUser.kakao_account?.email ?? null;
    const nickname = kakaoUser.kakao_account?.profile?.nickname ?? null;
    const profileImage = kakaoUser.kakao_account?.profile?.profile_image_url ?? null;

    // 3. DB에서 kakaoId로 유저 검색
    const existingUser = await this.prisma.user.findUnique({
      where: { kakaoId },
    });

    if (existingUser) {
      const token = jwt.sign(
        { sub: String(existingUser.id), userId: existingUser.userId, userType: existingUser.userType },
        this.jwtSecret as Secret,
        { expiresIn: '7d' as unknown as SignOptions['expiresIn'] },
      );

      return {
        isNewUser: false,
        token,
        userId: existingUser.userId,
        name: existingUser.userName,
      };
    }

    // 신규 회원 — 임시 토큰 발급
    const tempToken = jwt.sign(
      { kakaoId, email, nickname, profileImage, type: 'temp_signup' },
      this.jwtSecret as Secret,
      { expiresIn: '30m' as unknown as SignOptions['expiresIn'] },
    );

    return {
      isNewUser: true,
      tempToken,
      nickname,
    };
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
