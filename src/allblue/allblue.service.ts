import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllbluePrismaService } from '../allblue-prisma.service';
import * as bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AllblueS3Service } from './allblue-s3.service';
import * as fs from 'fs';
import * as path from 'path';

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

    const instructor = await this.prisma.user.findUnique({
      where: { id: instructorId },
      select: { userName: true },
    });

    const uuid = randomUUID();
    await this.prisma.form_submission.create({
      data: { uuid, instructorId, formId, diverName: diverName.trim(), instructorName: instructor?.userName ?? null },
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
          instructorName: submission.instructorName,
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
    const submission = await this.prisma.form_submission.findUnique({ where: { uuid } });
    if (!submission) {
      return { success: false, message: '존재하지 않는 양식입니다' };
    }
    if (submission.status === 'submitted') {
      return { success: false, message: '이미 제출된 양식입니다.' };
    }

    if (submission.formId === 'liability') {
      // 면책동의서
      const { signDate, signatureData, guardianSignature } = body;

      if (!signDate?.trim() || !signatureData?.trim()) {
        return { success: false, message: '날짜와 서명을 입력해주세요.' };
      }

      const signatureUrl = await this.s3.processSignatureData(signatureData, uuid, 'diver');

      await this.prisma.form_submission.update({
        where: { uuid },
        data: {
          signDate, signatureData: signatureUrl,
          guardianSignature: guardianSignature ?? null,
          status: 'submitted',
        },
      });
    } else {
      // 의료진술서 (medical)
      const {
        checkboxData, checkboxDetailData, birthDate, signDate, signatureData, guardianSignature,
        doctorName, doctorSignatureData, doctorDate, doctorPhone, doctorAddress, doctorAddressDetail, doctorChecks,
      } = body;

      if (!checkboxData || !birthDate?.trim() || !signDate?.trim() || !signatureData?.trim()) {
        return { success: false, message: '모든 항목을 입력해주세요.' };
      }

      // checkboxData에 "yes"가 하나라도 있으면 의사진술서 필수
      const hasYes = Object.values(checkboxData).some((v: any) => v === 'yes');

      if (hasYes) {
        if (
          !doctorName?.trim() || !doctorSignatureData?.trim() || !doctorDate?.trim() ||
          !doctorPhone?.trim() || !doctorAddress?.trim() || !doctorAddressDetail?.trim()
        ) {
          return { success: false, message: '의사 확인 정보를 모두 입력해주세요.' };
        }
      }

      const [signatureUrl, doctorSigUrl] = await Promise.all([
        this.s3.processSignatureData(signatureData, uuid, 'diver'),
        hasYes ? this.s3.processSignatureData(doctorSignatureData, uuid, 'doctor') : Promise.resolve(undefined),
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
          status: 'submitted',
        },
      });
    }

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

  async checkUserId(userId: string) {
    if (!userId?.trim()) {
      return { success: false, message: '아이디를 입력해주세요.' };
    }

    const [existingUser, pendingRequest] = await Promise.all([
      this.prisma.user.findUnique({ where: { userId: userId.trim() } }),
      this.prisma.instructor_register_request.findFirst({
        where: { userId: userId.trim(), status: 'pending' },
      }),
    ]);

    return { success: true, data: { available: !existingUser && !pendingRequest } };
  }

  async registerRequest(body: any, file: Express.Multer.File) {
    const { userId, name, phone, kakaoId, instaId, isInstructor, password } = body;

    if (!userId?.trim() || userId.trim().length < 4) {
      return { success: false, message: '아이디는 4자 이상 입력해주세요.' };
    }
    if (!name?.trim()) {
      return { success: false, message: '이름을 입력해주세요.' };
    }
    if (!password?.trim()) {
      return { success: false, message: '비밀번호를 입력해주세요.' };
    }
    if (Number(isInstructor) === 1 && !file) {
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

    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    await this.prisma.instructor_register_request.create({
      data: {
        userId: userId.trim(),
        name: name.trim(),
        password: hashedPassword,
        phone: phone?.trim() || null,
        kakaoId: kakaoId?.trim() || null,
        instaId: instaId?.trim() || null,
        isInstructor: Number(isInstructor) === 1 ? 1 : 0,
        certImageUrl,
      },
    });

    return { success: true };
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, userName: true, profileImage: true, profile: true },
    });

    if (!user) {
      return { success: false, message: '사용자를 찾을 수 없습니다.' };
    }

    const profile = user.profile
      ? {
          diverLevel: user.profile.diverLevel,
          description: user.profile.description,
          shoesSize: user.profile.shoesSize,
          finSize: user.profile.finSize,
          sta: user.profile.sta ? Number(user.profile.sta) : null,
          dynb: user.profile.dynb ? Number(user.profile.dynb) : null,
          dyn: user.profile.dyn ? Number(user.profile.dyn) : null,
          dnf: user.profile.dnf ? Number(user.profile.dnf) : null,
          fim: user.profile.fim ? Number(user.profile.fim) : null,
          cwtb: user.profile.cwtb ? Number(user.profile.cwtb) : null,
          cwt: user.profile.cwt ? Number(user.profile.cwt) : null,
          cnf: user.profile.cnf ? Number(user.profile.cnf) : null,
          level: user.profile.level,
        }
      : null;

    return {
      user: {
        id: user.id,
        name: user.userName,
        profileImage: user.profileImage,
      },
      profile,
    };
  }

  async updateProfile(userId: number, body: any) {
    const { diverLevel, description, shoesSize, finSize, sta, dynb, dyn, dnf, fim, cwtb, cwt, cnf } = body;

    if (body.name?.trim()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { userName: body.name.trim() },
      });
    }

    const data: any = {};
    if (diverLevel !== undefined) data.diverLevel = diverLevel;
    if (description !== undefined) data.description = description;
    if (shoesSize !== undefined) data.shoesSize = shoesSize;
    if (finSize !== undefined) data.finSize = finSize;
    if (sta !== undefined) data.sta = sta;
    if (dynb !== undefined) data.dynb = dynb;
    if (dyn !== undefined) data.dyn = dyn;
    if (dnf !== undefined) data.dnf = dnf;
    if (fim !== undefined) data.fim = fim;
    if (cwtb !== undefined) data.cwtb = cwtb;
    if (cwt !== undefined) data.cwt = cwt;
    if (cnf !== undefined) data.cnf = cnf;
    if (body.level !== undefined) data.level = body.level;

    const profile = await this.prisma.user_profile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return {
      success: true,
      profile: {
        diverLevel: profile.diverLevel,
        description: profile.description,
        shoesSize: profile.shoesSize,
        finSize: profile.finSize,
        sta: profile.sta ? Number(profile.sta) : null,
        dynb: profile.dynb ? Number(profile.dynb) : null,
        dyn: profile.dyn ? Number(profile.dyn) : null,
        dnf: profile.dnf ? Number(profile.dnf) : null,
        fim: profile.fim ? Number(profile.fim) : null,
        cwtb: profile.cwtb ? Number(profile.cwtb) : null,
        cwt: profile.cwt ? Number(profile.cwt) : null,
        cnf: profile.cnf ? Number(profile.cnf) : null,
        level: profile.level,
      },
    };
  }

  async uploadProfileImage(userId: number, file: Express.Multer.File) {
    if (!file) {
      return { success: false, message: '이미지 파일을 첨부해주세요.' };
    }

    const ext = file.originalname.split('.').pop() ?? 'jpg';
    const key = `profile/${userId}_${Date.now()}.${ext}`;
    let profileImage = await this.s3.uploadFile(file.buffer, key, file.mimetype);

    if (!profileImage) {
      const uploadDir = path.join(process.cwd(), 'uploads', 'profile');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const fileName = `${userId}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, fileName), file.buffer);
      const baseUrl = this.config.get<string>('BASE_URL', 'https://api.rumbaugh.co.kr');
      profileImage = `${baseUrl}/uploads/profile/${fileName}`;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { profileImage },
    });

    return { success: true, profileImage };
  }

  async uploadCert(userId: number, file: Express.Multer.File) {
    if (!file) {
      return { success: false, message: '자격증 이미지를 첨부해주세요.' };
    }

    const ext = file.originalname.split('.').pop() ?? 'jpg';
    const key = `certs/${userId}_${Date.now()}.${ext}`;
    let imageUrl = await this.s3.uploadFile(file.buffer, key, file.mimetype);

    if (!imageUrl) {
      const uploadDir = path.join(process.cwd(), 'uploads', 'certs');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const fileName = `${userId}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, fileName), file.buffer);
      const baseUrl = this.config.get<string>('BASE_URL', 'https://api.rumbaugh.co.kr');
      imageUrl = `${baseUrl}/uploads/certs/${fileName}`;
    }

    await this.prisma.cert_request.create({
      data: { userId, imageUrl },
    });

    return { success: true };
  }

  async getCertPendingCount() {
    const count = await this.prisma.cert_request.count({
      where: { status: 'pending' },
    });
    return { count };
  }

  async getCertRequests() {
    const requests = await this.prisma.cert_request.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { userId: true, userName: true, birthDate: true } } },
    });

    return {
      requests: requests.map(r => ({
        id: r.id,
        userId: r.user.userId,
        userName: r.user.userName,
        birthDate: r.user.birthDate,
        imageUrl: r.imageUrl,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async approveCertRequest(id: number, level: string) {
    const request = await this.prisma.cert_request.findUnique({ where: { id } });
    if (!request) {
      return { success: false, message: '존재하지 않는 요청입니다.' };
    }

    await this.prisma.cert_request.update({
      where: { id },
      data: { status: 'approved' },
    });

    await this.prisma.user_profile.upsert({
      where: { userId: request.userId },
      create: { userId: request.userId, level },
      update: { level },
    });

    return { success: true };
  }

  async rejectCertRequest(id: number, reason?: string) {
    await this.prisma.cert_request.update({
      where: { id },
      data: { status: 'rejected', rejectReason: reason?.trim() || null },
    });
    return { success: true };
  }

  async getCertLastReject(userId: number) {
    const request = await this.prisma.cert_request.findFirst({
      where: { userId, status: 'rejected' },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) {
      return { rejected: false };
    }

    return { rejected: true, reason: request.rejectReason };
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
    const request = await this.prisma.instructor_register_request.findUnique({ where: { id } });
    if (!request) {
      return { success: false, message: '존재하지 않는 요청입니다.' };
    }

    await this.prisma.instructor_register_request.update({
      where: { id },
      data: { status },
    });

    // 승인 시 user 테이블에 계정 생성
    if (status === 'approved') {
      const existingUser = await this.prisma.user.findUnique({ where: { userId: request.userId } });
      if (!existingUser) {
        await this.prisma.user.create({
          data: {
            userId: request.userId,
            password: request.password ?? '',
            userName: request.name,
            phone: request.phone,
            userType: Number(request.isInstructor) === 1 ? 'instructor' : 'user',
            status: 'approved',
          },
        });
      }
    }

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

    // birthDate 검증
    if (!birthDate?.trim()) {
      return { error: 'VALIDATION_ERROR', message: '생년월일을 입력해주세요.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) {
      return { error: 'VALIDATION_ERROR', message: '생년월일 형식이 올바르지 않습니다.' };
    }
    const [y, m, d] = birthDate.trim().split('-').map(Number);
    const birthDateObj = new Date(y, m - 1, d);
    if (birthDateObj.getFullYear() !== y || birthDateObj.getMonth() !== m - 1 || birthDateObj.getDate() !== d) {
      return { error: 'VALIDATION_ERROR', message: '존재하지 않는 날짜입니다.' };
    }
    const currentYear = new Date().getFullYear();
    if (y < 1900 || y > currentYear) {
      return { error: 'VALIDATION_ERROR', message: '생년월일이 올바르지 않습니다.' };
    }

    // phone 검증
    if (phone?.trim() && !/^\d{10,11}$/.test(phone.trim())) {
      return { error: 'VALIDATION_ERROR', message: '전화번호는 숫자 10~11자리로 입력해주세요.' };
    }

    if (!phone?.trim() && !kakaoTalkId?.trim() && !instagramId?.trim()) {
      return { error: 'VALIDATION_ERROR', message: '연락처 정보를 최소 1개 입력해주세요.' };
    }

    // 3. DB에 유저 생성
    const provider = decoded.kakaoId ? 'kakao' : decoded.googleId ? 'google' : decoded.naverId ? 'naver' : 'apple';
    const socialId = decoded.kakaoId ?? decoded.googleId ?? decoded.naverId ?? decoded.appleId;
    const randomPassword = await bcrypt.hash(randomUUID(), 10);
    const user = await this.prisma.user.create({
      data: {
        userId: `${provider}_${socialId}`,
        password: randomPassword,
        userName: name.trim(),
        email: decoded.email,
        phone: phone?.trim() || null,
        kakaoId: decoded.kakaoId ?? null,
        googleId: decoded.googleId ?? null,
        naverId: decoded.naverId ?? null,
        appleId: decoded.appleId ?? null,
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
        profileImage: existingUser.profileImage,
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
      profileImage,
    };
  }

  async googleAuthCallback(code: string) {
    if (!code) {
      return { error: true, message: '인증코드가 없습니다.' };
    }

    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET', '');
    const redirectUri = this.config.get<string>('GOOGLE_REDIRECT_URI', 'https://api.rumbaugh.co.kr/allblue/auth/google/callback');

    // 1. 구글 토큰 교환
    console.log('[구글] 토큰 교환 요청:', {
      code: code?.substring(0, 20) + '...',
      redirect_uri: redirectUri,
      client_id: clientId,
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    console.log('[구글] 토큰 교환 응답:', JSON.stringify(tokenData));

    if (!tokenData.access_token) {
      return { error: true, message: '구글 인증에 실패했습니다.' };
    }

    // 2. 구글 사용자 정보 조회
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json() as any;
    console.log('[구글] 유저 정보:', JSON.stringify(googleUser));

    const googleId = String(googleUser.id);
    const email = googleUser.email ?? null;
    const nickname = googleUser.name ?? null;
    const profileImage = googleUser.picture ?? null;

    // 3. DB에서 googleId로 유저 검색
    const existingUser = await this.prisma.user.findUnique({
      where: { googleId },
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
        profileImage: existingUser.profileImage,
      };
    }

    // 신규 회원 — 임시 토큰 발급
    const tempToken = jwt.sign(
      { googleId, email, nickname, profileImage, type: 'temp_signup' },
      this.jwtSecret as Secret,
      { expiresIn: '30m' as unknown as SignOptions['expiresIn'] },
    );

    return {
      isNewUser: true,
      tempToken,
      nickname,
      profileImage,
    };
  }

  async naverAuthCallback(code: string, state: string) {
    if (!code) {
      return { error: true, message: '인증코드가 없습니다.' };
    }

    const clientId = this.config.get<string>('NAVER_CLIENT_ID', '');
    const clientSecret = this.config.get<string>('NAVER_CLIENT_SECRET', '');

    // 1. 네이버 토큰 교환
    const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        state,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      return { error: true, message: '네이버 인증에 실패했습니다.' };
    }

    // 2. 네이버 사용자 정보 조회
    const userRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const naverData = await userRes.json() as any;
    const naverUser = naverData.response;

    const naverId = String(naverUser.id);
    const email = naverUser.email ?? null;
    const nickname = naverUser.name ?? null;
    const profileImage = naverUser.profile_image ?? null;

    // 3. DB에서 naverId로 유저 검색
    const existingUser = await this.prisma.user.findUnique({
      where: { naverId },
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
        profileImage: existingUser.profileImage,
      };
    }

    // 신규 회원 — 임시 토큰 발급
    const tempToken = jwt.sign(
      { naverId, email, nickname, profileImage, type: 'temp_signup' },
      this.jwtSecret as Secret,
      { expiresIn: '30m' as unknown as SignOptions['expiresIn'] },
    );

    return {
      isNewUser: true,
      tempToken,
      nickname,
      profileImage,
    };
  }

  private generateAppleClientSecret(): string {
    const teamId = this.config.get<string>('APPLE_TEAM_ID', 'CHDRTR39G7');
    const keyId = this.config.get<string>('APPLE_KEY_ID', 'V836FM9R4N');
    const clientId = this.config.get<string>('APPLE_CLIENT_ID', 'com.rumbaugh.allblue.service');
    const keyPath = this.config.get<string>('APPLE_PRIVATE_KEY_PATH', path.join(process.cwd(), 'keys', 'AuthKey_V836FM9R4N.p8'));

    const privateKey = fs.readFileSync(keyPath, 'utf8');
    const now = Math.floor(Date.now() / 1000);

    return jwt.sign(
      { iss: teamId, iat: now, exp: now + 600, aud: 'https://appleid.apple.com', sub: clientId },
      privateKey,
      { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId } } as any,
    );
  }

  async appleAuthCallback(code: string, userParam?: string) {
    if (!code) {
      return { error: true, message: '인증코드가 없습니다.' };
    }

    const clientId = this.config.get<string>('APPLE_CLIENT_ID', 'com.rumbaugh.allblue.service');
    const redirectUri = this.config.get<string>('APPLE_REDIRECT_URI', 'https://api.rumbaugh.co.kr/allblue/auth/apple/callback');
    const clientSecret = this.generateAppleClientSecret();

    // 1. 애플 토큰 교환
    const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (!tokenData.id_token) {
      return { error: true, message: '애플 인증에 실패했습니다.' };
    }

    // 2. id_token 디코드
    const decoded = jwt.decode(tokenData.id_token) as any;
    const appleId = decoded.sub;
    const email = decoded.email ?? null;

    // 3. user 파라미터에서 이름 추출 (최초 로그인 시에만)
    let nickname: string | null = null;
    if (userParam) {
      try {
        const userInfo = typeof userParam === 'string' ? JSON.parse(userParam) : userParam;
        const firstName = userInfo?.name?.firstName ?? '';
        const lastName = userInfo?.name?.lastName ?? '';
        nickname = `${lastName}${firstName}`.trim() || null;
      } catch {}
    }

    // 4. DB에서 appleId로 유저 검색
    const existingUser = await this.prisma.user.findUnique({
      where: { appleId },
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
      { appleId, email, nickname, type: 'temp_signup' },
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
