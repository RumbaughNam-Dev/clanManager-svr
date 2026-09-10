import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllbluePrismaService } from '../allblue-prisma.service';
import * as bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AllblueS3Service } from './allblue-s3.service';
import * as fs from 'fs';
import * as path from 'path';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

@Injectable()
export class AllblueService {
  private jwtSecret: string;
  private snsClient: SNSClient;

  constructor(
    private prisma: AllbluePrismaService,
    private config: ConfigService,
    private s3: AllblueS3Service,
  ) {
    this.jwtSecret = this.config.get<string>('JWT_SECRET', 'dev-allblue-secret');
    this.snsClient = new SNSClient({ region: 'ap-northeast-2' });
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

    // // 중복 로그인 차단
    // if (user.refreshToken) {
    //   await this.logHistory(user.id, 'fail_duplicate', ip);
    //   return {
    //     success: false,
    //     message: '다른 기기에서 이미 로그인되어 있습니다. 기존 기기에서 로그아웃 후 다시 시도해주세요.',
    //   };
    // }

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
          nickname: user.nickname,
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
      select: { nickname: true },
    });

    const uuid = randomUUID();
    await this.prisma.form_submission.create({
      data: { uuid, instructorId, formId, diverName: diverName.trim(), instructorName: instructor?.nickname ?? null },
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
      const key = `allblue/instructor-certs/${Date.now()}_${file.originalname}`;
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
      select: { id: true, nickname: true, userName: true, profileImage: true, profile: true },
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
        nickname: user.nickname,
        name: user.userName ?? null,
        profileImage: user.profileImage,
      },
      profile,
    };
  }

  async getProfileByUserId(userId: string, currentUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!user) {
      return { success: false, message: '사용자를 찾을 수 없습니다.' };
    }

    const result = await this.getProfile(user.id);

    // isMyStudent 판정
    let isMyStudent = false;
    const currentUser = await this.prisma.user.findUnique({
      where: { userId: currentUserId },
      select: { profile: { select: { level: true } } },
    });
    const level = currentUser?.profile?.level;
    if (level === '5' || level === 'A') {
      const count = await this.prisma.schedule_participant.count({
        where: {
          userId,
          schedule: {
            instructorId: currentUserId,
            categoryCode: { in: ['EXPERIENCE', 'CERTIFICATION', 'LECTURE'] },
          },
        },
      });
      isMyStudent = count > 0;
    }

    return { ...result, isMyStudent };
  }

  async updateProfile(userId: number, body: any) {
    const { diverLevel, description, shoesSize, finSize, sta, dynb, dyn, dnf, fim, cwtb, cwt, cnf } = body;

    const userData: any = {};
    if (body.nickname?.trim()) userData.nickname = body.nickname.trim();
    if (body.name !== undefined) userData.userName = body.name?.trim() || null;
    if (Object.keys(userData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: userData,
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
    const key = `allblue/profile/${userId}_${Date.now()}.${ext}`;
    let profileImage = await this.s3.uploadFile(file.buffer, key, file.mimetype);

    if (!profileImage) {
      const uploadDir = path.join(process.cwd(), 'uploads', 'profile');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const fileName = `${userId}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, fileName), file.buffer);
      const baseUrl = this.config.get<string>('BASE_URL', 'https://api.rumbaugh.co.kr');
      profileImage = `${baseUrl}/allblue/uploads/profile/${fileName}`;
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
    const key = `allblue/certs/${userId}_${Date.now()}.${ext}`;
    let imageUrl = await this.s3.uploadFile(file.buffer, key, file.mimetype);

    if (!imageUrl) {
      const uploadDir = path.join(process.cwd(), 'uploads', 'certs');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const fileName = `${userId}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, fileName), file.buffer);
      const baseUrl = this.config.get<string>('BASE_URL', 'https://api.rumbaugh.co.kr');
      imageUrl = `${baseUrl}/allblue/uploads/certs/${fileName}`;
    }

    await this.prisma.cert_request.create({
      data: { userId, imageUrl },
    });

    return { success: true };
  }

  async getDivingPools() {
    const pools = await this.prisma.diving_pool.findMany({
      where: { status: 'OPERATING' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { pools };
  }

  async searchUsers(q: string, currentUserId: number) {
    if (!q?.trim()) {
      return { users: [] };
    }

    const users = await this.prisma.user.findMany({
      where: { OR: [{ nickname: { contains: q.trim() } }, { userName: { contains: q.trim() } }] },
      select: { id: true, userId: true, nickname: true, userName: true, phone: true, birthDate: true, profile: { select: { level: true } } },
    });

    // 현재 강사의 교육생(참가자로 등록된 적 있는 유저)을 최상단
    const myStudentIds = await this.prisma.schedule_participant.findMany({
      where: {
        schedule: { instructorId: users.find(u => u.id === currentUserId)?.userId ?? '' },
        userId: { in: users.map(u => u.userId) },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    const studentIdSet = new Set(myStudentIds.map(s => s.userId));

    const sorted = users.sort((a, b) => {
      const aStudent = studentIdSet.has(a.userId) ? 0 : 1;
      const bStudent = studentIdSet.has(b.userId) ? 0 : 1;
      if (aStudent !== bStudent) return aStudent - bStudent;
      return a.nickname.localeCompare(b.nickname, 'ko');
    });

    return {
      users: sorted.map(u => ({ id: u.id, nickname: u.nickname, name: u.userName ?? null, phone: u.phone, birthDate: u.birthDate ?? null, level: u.profile?.level ?? '0' })),
    };
  }

  async createSchedule(body: any, instructorUserId: string) {
    const { title, scheduleDate, startHour, startMinute, poolId, categoryCode, participantIds, guests } = body;

    if (!title?.trim() || title.trim().length > 100) {
      return { success: false, message: '제목을 입력해주세요. (최대 100자)' };
    }
    if (!scheduleDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
      return { success: false, message: '날짜를 YYYY-MM-DD 형식으로 입력해주세요.' };
    }
    if (!categoryCode) {
      return { success: false, message: '분류를 선택해주세요.' };
    }
    if (startHour < 0 || startHour > 23 || startMinute < 0 || startMinute > 59) {
      return { success: false, message: '시간을 올바르게 입력해주세요.' };
    }

    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.schedule.create({
        data: {
          title: title.trim(),
          scheduleDate: new Date(scheduleDate),
          startHour,
          startMinute,
          poolId: poolId ?? null,
          categoryCode,
          instructorId: instructorUserId,
        },
      });

      // 강사 INT id 조회 (form_submission.instructorId용)
      const instructor = await tx.user.findUnique({
        where: { userId: instructorUserId },
        select: { id: true, nickname: true },
      });

      if (participantIds?.length > 0) {
        // user.id(INT) → user.userId(VARCHAR) 변환
        const users = await tx.user.findMany({
          where: { id: { in: participantIds } },
          select: { userId: true, nickname: true, userName: true },
        });

        await tx.schedule_participant.createMany({
          data: users.map((u) => ({
            scheduleId: schedule.id,
            userId: u.userId,
          })),
        });

        // 면책동의서·의료진술서 자동 생성
        for (const u of users) {
          await tx.form_submission.createMany({
            data: ['liability', 'medical'].map(formId => ({
              uuid: randomUUID(),
              formId,
              diverName: u.nickname ?? u.userName ?? '',
              instructorId: instructor!.id,
              instructorName: instructor!.nickname,
              scheduleId: schedule.id,
              participantUserId: u.userId,
            })),
          });
        }
      }

      if (guests?.length > 0) {
        for (const g of guests) {
          if (!g.nickname?.trim()) continue;
          const guest = await tx.guest_user.create({
            data: {
              nickname: g.nickname.trim(),
              phone: g.phone?.trim() || null,
            },
          });
          await tx.schedule_participant.create({
            data: {
              scheduleId: schedule.id,
              guestId: guest.id,
            },
          });

          // 면책동의서·의료진술서 자동 생성
          await tx.form_submission.createMany({
            data: ['liability', 'medical'].map(formId => ({
              uuid: randomUUID(),
              formId,
              diverName: guest.nickname,
              instructorId: instructor!.id,
              instructorName: instructor!.nickname,
              scheduleId: schedule.id,
              participantGuestId: guest.id,
            })),
          });
        }
      }

      // dive_buddy 갱신
      const allParticipants = await tx.schedule_participant.findMany({
        where: { scheduleId: schedule.id, userId: { not: null } },
        select: { userId: true },
      });
      await this.updateDiveBuddies(tx, schedule.id, new Date(scheduleDate), instructorUserId, allParticipants.map(p => p.userId!));

      return { success: true, scheduleId: schedule.id };
    });
  }

  async getDailySchedules(date: string, userId: string) {
    if (!date?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      return { success: false, message: 'date 파라미터를 YYYY-MM-DD 형식으로 입력해주세요.' };
    }

    const scheduleDate = new Date(date.trim());

    const schedules = await this.prisma.schedule.findMany({
      where: {
        scheduleDate,
        OR: [
          { instructorId: userId },
          { participants: { some: { userId } } },
        ],
      },
      orderBy: [{ startHour: 'asc' }, { startMinute: 'asc' }],
      include: {
        pool: { select: { name: true } },
        instructor: { select: { nickname: true, userName: true } },
        participants: { include: { user: { select: { nickname: true, userName: true, profile: { select: { level: true } } } }, guest: { select: { nickname: true } } } },
      },
    });

    // categoryCode → categoryName 매핑
    const categoryCodes = [...new Set(schedules.map(s => s.categoryCode))];
    const codes = categoryCodes.length > 0
      ? await this.prisma.common_code.findMany({
          where: { codeGroup: 'SCHEDULE_TYPE', code: { in: categoryCodes } },
        })
      : [];
    const codeMap = new Map(codes.map(c => [c.code, c.nameKo ?? c.name]));

    return {
      schedules: schedules.map(s => ({
        id: s.id,
        title: s.title,
        scheduleDate: date.trim(),
        startHour: s.startHour,
        startMinute: s.startMinute,
        poolName: s.pool?.name ?? null,
        categoryCode: s.categoryCode,
        categoryName: codeMap.get(s.categoryCode) ?? s.categoryCode,
        instructorName: s.instructor.nickname,
        participantCount: s.participants.length,
        participantNames: s.participants.map(p => p.user?.nickname ?? p.guest?.nickname ?? ''),
        participants: s.participants.map(p => ({
          nickname: p.user?.nickname ?? p.guest?.nickname ?? '',
          name: p.user?.userName ?? null,
          level: p.user?.profile?.level ?? null,
        })),
      })),
    };
  }

  async getMonthlySchedules(yearStr: string, monthStr: string, userId: string) {
    const year = Number(yearStr);
    const month = Number(monthStr);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return { success: false, message: 'year, month 파라미터를 올바르게 입력해주세요.' };
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const schedules = await this.prisma.schedule.findMany({
      where: {
        scheduleDate: { gte: startDate, lt: endDate },
        OR: [
          { instructorId: userId },
          { participants: { some: { userId } } },
        ],
      },
      orderBy: [{ scheduleDate: 'asc' }, { startHour: 'asc' }, { startMinute: 'asc' }],
      include: {
        pool: { select: { name: true } },
        instructor: { select: { nickname: true, userName: true, profile: { select: { level: true } } } },
        participants: { include: { user: { select: { nickname: true, userName: true, profile: { select: { level: true } } } }, guest: { select: { nickname: true } } } },
      },
    });

    const categoryCodes = [...new Set(schedules.map(s => s.categoryCode))];
    const codes = categoryCodes.length > 0
      ? await this.prisma.common_code.findMany({
          where: { codeGroup: 'SCHEDULE_TYPE', code: { in: categoryCodes } },
        })
      : [];
    const codeMap = new Map(codes.map(c => [c.code, c.nameKo ?? c.name]));

    const levelOrder = ['0', '1', '2', '3', '4', '5', 'A'];

    return {
      schedules: schedules.map(s => {
        const d = s.scheduleDate;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        // 강사 + 참석자 레벨 수집 (null/미설정은 '0'으로 취급)
        const levels: string[] = [];
        levels.push(s.instructor.profile?.level || '0');
        for (const p of s.participants) {
          levels.push(p.user?.profile?.level || '0');
        }

        const minLevel = levels.reduce((min, l) => levelOrder.indexOf(l) < levelOrder.indexOf(min) ? l : min);

        return {
          id: s.id,
          title: s.title,
          scheduleDate: dateStr,
          startHour: s.startHour,
          startMinute: s.startMinute,
          poolName: s.pool?.name ?? null,
          categoryCode: s.categoryCode,
          categoryName: codeMap.get(s.categoryCode) ?? s.categoryCode,
          instructorName: s.instructor.nickname,
          participantCount: s.participants.length,
          participantNames: s.participants.map(p => p.user?.nickname ?? p.guest?.nickname ?? ''),
          minLevel,
        };
      }),
    };
  }

  async getScheduleDetail(id: number, userId: string) {
    if (!id || isNaN(id)) {
      return { success: false, message: '유효하지 않은 일정 ID입니다.' };
    }

    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      include: {
        pool: { select: { name: true } },
        instructor: { select: { nickname: true } },
        participants: {
          include: {
            user: {
              select: {
                id: true, nickname: true, userName: true,
                profile: { select: { level: true } },
                licenses: { where: { status: 'IN_PROGRESS' }, select: { id: true }, take: 1 },
              },
            },
            guest: { select: { id: true, nickname: true } },
          },
        },
        formSubmissions: {
          select: { formId: true, uuid: true, status: true, participantUserId: true, participantGuestId: true },
        },
      },
    });

    if (!schedule) {
      return { success: false, message: '존재하지 않는 일정입니다.' };
    }

    // 권한 체크: 강사이거나 참석자여야 함
    const isOwner = schedule.instructorId === userId;
    const myParticipant = schedule.participants.find(p => p.userId === userId);
    const isParticipant = !!myParticipant;
    if (!isOwner && !isParticipant) {
      return { success: false, statusCode: 403, message: '조회 권한이 없습니다.' };
    }

    // categoryName 조회
    const code = await this.prisma.common_code.findUnique({
      where: { codeGroup_code: { codeGroup: 'SCHEDULE_TYPE', code: schedule.categoryCode } },
    });

    // debriefing 존재 여부 조회
    const debriefings = await this.prisma.debriefing.findMany({
      where: { scheduleId: id },
      select: { participantId: true },
      distinct: ['participantId'],
    });
    const debriefedIds = new Set(debriefings.map(d => d.participantId));

    const d = schedule.scheduleDate;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return {
      schedule: {
        id: schedule.id,
        title: schedule.title,
        isOwner,
        myParticipantId: myParticipant?.user?.id ?? null,
        scheduleDate: dateStr,
        startHour: schedule.startHour,
        startMinute: schedule.startMinute,
        poolName: schedule.pool?.name ?? '',
        categoryCode: schedule.categoryCode,
        categoryName: code?.nameKo ?? code?.name ?? schedule.categoryCode,
        instructorName: schedule.instructor.nickname,
        participants: schedule.participants.map(p => {
          const isGuest = !p.user;
          const waiver = schedule.formSubmissions.find(f =>
            f.formId === 'liability' &&
            (isGuest ? f.participantGuestId === p.guestId : f.participantUserId === p.userId),
          );
          const medical = schedule.formSubmissions.find(f =>
            f.formId === 'medical' &&
            (isGuest ? f.participantGuestId === p.guestId : f.participantUserId === p.userId),
          );
          const baseUrl = 'https://rumbaugh.co.kr/form';

          return {
            id: isGuest ? p.guest!.id : p.user!.id,
            nickname: isGuest ? p.guest!.nickname : p.user!.nickname,
            name: isGuest ? null : (p.user!.userName ?? null),
            isGuest,
            waiverSigned: waiver?.status === 'submitted',
            medicalSigned: medical?.status === 'submitted',
            waiverUrl: waiver?.status === 'submitted' ? `${baseUrl}/${waiver.uuid}` : null,
            medicalUrl: medical?.status === 'submitted' ? `${baseUrl}/${medical.uuid}` : null,
            waiverUuid: waiver?.uuid ?? null,
            medicalUuid: medical?.uuid ?? null,
            level: isGuest ? '0' : (p.user!.profile?.level ?? '0'),
            hasInProgressLicense: isGuest ? false : (p.user!.licenses?.length > 0),
            debriefingDone: debriefedIds.has(isGuest ? p.guest!.id : p.user!.id),
          };
        }),
      },
    };
  }

  async deleteSchedule(id: number, userId: string) {
    const schedule = await this.prisma.schedule.findUnique({ where: { id } });

    if (!schedule) {
      return { success: false, statusCode: 404, message: '존재하지 않는 일정입니다.' };
    }

    if (schedule.instructorId !== userId) {
      return { success: false, statusCode: 403, message: '삭제 권한이 없습니다.' };
    }

    await this.prisma.$transaction(async (tx) => {
      // submitted 아닌 서류 삭제
      await tx.form_submission.deleteMany({
        where: { scheduleId: id, status: { not: 'submitted' } },
      });
      // submitted 서류는 연결 해제 (데이터 보존)
      await tx.form_submission.updateMany({
        where: { scheduleId: id, status: 'submitted' },
        data: { scheduleId: null },
      });
      // 참석자 → 일정 삭제
      await tx.schedule_participant.deleteMany({ where: { scheduleId: id } });
      await tx.schedule.delete({ where: { id } });
    });

    return { success: true };
  }

  async updateSchedule(id: number, body: any, instructorUserId: string) {
    const { title, scheduleDate, startHour, startMinute, poolId, categoryCode, participantIds, guests } = body;

    const schedule = await this.prisma.schedule.findUnique({ where: { id } });
    if (!schedule) {
      return { success: false, statusCode: 404, message: '존재하지 않는 일정입니다.' };
    }
    if (schedule.instructorId !== instructorUserId) {
      return { success: false, statusCode: 403, message: '수정 권한이 없습니다.' };
    }

    if (!title?.trim() || title.trim().length > 100) {
      return { success: false, message: '제목을 입력해주세요. (최대 100자)' };
    }
    if (!scheduleDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
      return { success: false, message: '날짜를 YYYY-MM-DD 형식으로 입력해주세요.' };
    }
    if (!categoryCode) {
      return { success: false, message: '분류를 선택해주세요.' };
    }
    if (startHour < 0 || startHour > 23 || startMinute < 0 || startMinute > 59) {
      return { success: false, message: '시간을 올바르게 입력해주세요.' };
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. schedule 본문 수정
      await tx.schedule.update({
        where: { id },
        data: {
          title: title.trim(),
          scheduleDate: new Date(scheduleDate),
          startHour,
          startMinute,
          poolId: poolId ?? null,
          categoryCode,
        },
      });

      // 강사 정보 조회 (form_submission용)
      const instructor = await tx.user.findUnique({
        where: { userId: instructorUserId },
        select: { id: true, nickname: true },
      });

      // 2. 앱 사용자 참석자 처리 (participantIds가 명시적으로 전달된 경우만)
      if (participantIds !== undefined && participantIds !== null) {
        const existingParticipants = await tx.schedule_participant.findMany({
          where: { scheduleId: id, userId: { not: null } },
        });
        const existingUserIds = existingParticipants.map(p => p.userId!);

        const newUsers = participantIds.length > 0
          ? await tx.user.findMany({
              where: { id: { in: participantIds } },
              select: { id: true, userId: true, nickname: true, userName: true },
            })
          : [];
        const newUserIds = newUsers.map(u => u.userId);

        const removedUserIds = existingUserIds.filter(uid => !newUserIds.includes(uid));
        const addedUserIds = newUserIds.filter(uid => !existingUserIds.includes(uid));

        // 제거된 앱 사용자 처리
        for (const removedUserId of removedUserIds) {
          await tx.form_submission.deleteMany({
            where: { scheduleId: id, participantUserId: removedUserId, status: { not: 'submitted' } },
          });
          await tx.form_submission.updateMany({
            where: { scheduleId: id, participantUserId: removedUserId, status: 'submitted' },
            data: { scheduleId: null },
          });
          await tx.schedule_participant.deleteMany({
            where: { scheduleId: id, userId: removedUserId },
          });
        }

        // 추가된 앱 사용자 INSERT
        for (const addedUserId of addedUserIds) {
          const user = newUsers.find(u => u.userId === addedUserId)!;
          await tx.schedule_participant.create({
            data: { scheduleId: id, userId: addedUserId },
          });
          await tx.form_submission.createMany({
            data: ['liability', 'medical'].map(formId => ({
              uuid: randomUUID(),
              formId,
              diverName: user.nickname ?? user.userName ?? '',
              instructorId: instructor!.id,
              instructorName: instructor!.nickname,
              scheduleId: id,
              participantUserId: addedUserId,
            })),
          });
        }
      }

      // 3. 게스트 참석자 처리 (guests가 명시적으로 전달된 경우만)
      if (guests !== undefined && guests !== null) {
        const existingGuestParticipants = await tx.schedule_participant.findMany({
          where: { scheduleId: id, guestId: { not: null } },
        });
        const existingGuestIds = existingGuestParticipants.map(p => p.guestId!);

        // 기존 게스트 제거
        for (const guestId of existingGuestIds) {
          await tx.form_submission.deleteMany({
            where: { scheduleId: id, participantGuestId: guestId, status: { not: 'submitted' } },
          });
          await tx.form_submission.updateMany({
            where: { scheduleId: id, participantGuestId: guestId, status: 'submitted' },
            data: { scheduleId: null },
          });
          await tx.schedule_participant.deleteMany({
            where: { scheduleId: id, guestId },
          });
        }

        // 새 게스트 INSERT
        for (const g of guests) {
          if (!g.nickname?.trim()) continue;
          const guest = await tx.guest_user.create({
            data: { nickname: g.nickname.trim(), phone: g.phone?.trim() || null },
          });
          await tx.schedule_participant.create({
            data: { scheduleId: id, guestId: guest.id },
          });
          await tx.form_submission.createMany({
            data: ['liability', 'medical'].map(formId => ({
              uuid: randomUUID(),
              formId,
              diverName: guest.nickname,
              instructorId: instructor!.id,
              instructorName: instructor!.nickname,
              scheduleId: id,
              participantGuestId: guest.id,
            })),
          });
        }
      }

      // dive_buddy 갱신 - 현재 참석자 전체 기준
      const finalParticipants = await tx.schedule_participant.findMany({
        where: { scheduleId: id, userId: { not: null } },
        select: { userId: true },
      });
      await this.updateDiveBuddies(tx, id, new Date(scheduleDate), instructorUserId, finalParticipants.map(p => p.userId!));

      return { success: true };
    });
  }

  async getUserAchievements(userIntId: number, currentUserId: number) {
    // user.id(INT) → user.userId(VARCHAR) 조회
    const user = await this.prisma.user.findUnique({
      where: { id: userIntId },
      select: { userId: true },
    });
    if (!user) {
      return { success: false, message: '사용자를 찾을 수 없습니다.' };
    }

    // user_license (userId: VARCHAR)로 진행 중인 자격증 조회
    const userLicenses = await this.prisma.user_license.findMany({
      where: { userId: user.userId },
      include: {
        license: {
          include: {
            association: { select: { code: true, name: true, nameKo: true } },
            requirements: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true, parentId: true, reqGroup: true, reqType: true, code: true,
                name: true, nameKo: true, unit: true,
                minValue: true, maxValue: true, displayValue: true,
                isOptional: true, sortOrder: true, note: true,
              },
            },
          },
        },
      },
    });

    // user_license_achievement (userId: INT)로 완료된 항목 조회
    const achievements = await this.prisma.user_license_achievement.findMany({
      where: { userId: userIntId },
      select: { requirementId: true, isCompleted: true, completedAt: true, completedBy: true },
    });
    const achievementMap = new Map(achievements.map(a => [a.requirementId, a]));

    return {
      licenses: userLicenses.map(ul => ({
        id: ul.id,
        status: ul.status,
        startedAt: ul.startedAt?.toISOString() ?? null,
        completedAt: ul.completedAt?.toISOString() ?? null,
        certificateNumber: ul.certificateNumber,
        license: {
          id: ul.license.id,
          code: ul.license.code,
          name: ul.license.name,
          nameKo: ul.license.nameKo,
          association: ul.license.association,
        },
        requirements: ul.license.requirements.map(r => {
          const achievement = achievementMap.get(r.id);
          return {
            id: r.id,
            parentId: r.parentId,
            reqGroup: r.reqGroup,
            reqType: r.reqType,
            code: r.code,
            name: r.name,
            nameKo: r.nameKo,
            unit: r.unit,
            minValue: r.minValue ? Number(r.minValue) : null,
            maxValue: r.maxValue ? Number(r.maxValue) : null,
            displayValue: r.displayValue,
            isOptional: r.isOptional,
            sortOrder: r.sortOrder,
            note: r.note,
            isCompleted: achievement?.isCompleted === 1,
            completedAt: achievement?.completedAt?.toISOString() ?? null,
            completedBy: achievement?.completedBy ?? null,
            completedByMe: achievement?.isCompleted === 1 && achievement?.completedBy === currentUserId,
          };
        }),
        completedCount: achievements.filter(a =>
          a.isCompleted === 1 && ul.license.requirements.some(r => r.id === a.requirementId),
        ).length,
        totalCount: ul.license.requirements.length,
      })),
    };
  }

  async toggleAchievement(body: { requirementId: number; userId: number; completed: boolean }, currentUserId: number) {
    const { requirementId, userId, completed } = body;

    if (!requirementId || !userId) {
      return { success: false, message: 'requirementId와 userId는 필수입니다.' };
    }

    const existing = await this.prisma.user_license_achievement.findUnique({
      where: { userId_requirementId: { userId, requirementId } },
    });

    if (completed) {
      // 통과처리 - 강사/관리자 여부 확인 (user_profile.level)
      const currentUser = await this.prisma.user.findUnique({
        where: { id: currentUserId },
        select: { profile: { select: { level: true } } },
      });
      const level = currentUser?.profile?.level;
      if (!level || !['5', 'A'].includes(level)) {
        return { success: false, message: '강사만 통과처리할 수 있습니다.' };
      }

      if (existing) {
        await this.prisma.user_license_achievement.update({
          where: { id: existing.id },
          data: { isCompleted: 1, completedAt: new Date(), completedBy: currentUserId },
        });
      } else {
        await this.prisma.user_license_achievement.create({
          data: { userId, requirementId, isCompleted: 1, completedAt: new Date(), completedBy: currentUserId },
        });
      }
    } else {
      // 통과취소
      if (!existing) {
        return { success: false, message: '해당 성취 기록이 없습니다.' };
      }
      console.log('[toggleAchievement:cancel] existing.completedBy:', existing.completedBy, typeof existing.completedBy, '/ currentUserId:', currentUserId, typeof currentUserId);
      if (existing.completedBy !== currentUserId) {
        return { success: false, message: '과제를 통과시킨 강사 본인만 취소 처리 할 수 있어요.' };
      }
      await this.prisma.user_license_achievement.update({
        where: { id: existing.id },
        data: { isCompleted: 0, completedAt: null, completedBy: null },
      });
    }

    return { success: true };
  }

  async getUserDebriefings(userIntId: number, page: number, limit: number) {
    const offset = (page - 1) * limit;

    const debriefings = await this.prisma.debriefing.findMany({
      where: { participantId: userIntId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit + 1,
      include: {
        schedule: { select: { title: true, scheduleDate: true } },
        creator: { select: { nickname: true } },
      },
    });

    const hasMore = debriefings.length > limit;
    const items = debriefings.slice(0, limit);

    return {
      debriefings: items.map(d => {
        const sd = d.schedule.scheduleDate;
        const dateStr = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
        return {
          id: d.id,
          scheduleTitle: d.schedule.title,
          scheduleDate: dateStr,
          content: d.content,
          createdByName: d.creator.nickname,
          createdAt: d.createdAt.toISOString(),
        };
      }),
      hasMore,
    };
  }

  private async updateDiveBuddies(tx: any, scheduleId: number, scheduleDate: Date, instructorUserId: string, participantUserIds: string[]) {
    // 강사 포함 전체 userId 목록 (게스트 제외)
    const allUserIds = [instructorUserId, ...participantUserIds.filter(id => id !== instructorUserId)];
    if (allUserIds.length < 2) return;

    const diveDate = scheduleDate;

    for (let i = 0; i < allUserIds.length; i++) {
      for (let j = 0; j < allUserIds.length; j++) {
        if (i === j) continue;
        const userId = allUserIds[i];
        const buddyId = allUserIds[j];

        const existing = await tx.dive_buddy.findUnique({
          where: { userId_buddyId: { userId, buddyId } },
        });

        if (!existing || existing.lastDiveDate <= diveDate) {
          await tx.dive_buddy.upsert({
            where: { userId_buddyId: { userId, buddyId } },
            create: { userId, buddyId, lastDiveDate: diveDate, scheduleId },
            update: { lastDiveDate: diveDate, scheduleId },
          });
        }
      }
    }
  }

  private async getUserFriendInfo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { userId },
      select: {
        userId: true, nickname: true, userName: true,
        profile: { select: { level: true } },
        licenses: { where: { status: 'IN_PROGRESS' }, select: { license: { select: { nameKo: true, name: true } } }, take: 1 },
      },
    });
    if (!user) return null;
    return {
      userId: user.userId,
      nickname: user.nickname,
      name: user.userName ?? null,
      level: user.profile?.level ?? '0',
      licenseName: user.licenses[0]?.license?.nameKo ?? user.licenses[0]?.license?.name ?? null,
    };
  }

  private async getBlockedIds(userId: string): Promise<Set<string>> {
    const blocked = await this.prisma.blocked_user.findMany({
      where: { userId },
      select: { blockedId: true },
    });
    return new Set(blocked.map(b => b.blockedId));
  }

  async getBuddies(userId: string, page: number, limit: number) {
    const blockedIds = await this.getBlockedIds(userId);
    const offset = (page - 1) * limit;
    const buddies = await this.prisma.dive_buddy.findMany({
      where: { userId, buddyId: { notIn: [...blockedIds] } },
      orderBy: { lastDiveDate: 'desc' },
      skip: offset,
      take: limit + 1,
    });

    const hasMore = buddies.length > limit;
    const items = buddies.slice(0, limit);

    const buddyUsers = await this.prisma.user.findMany({
      where: { userId: { in: items.map(b => b.buddyId) } },
      select: {
        userId: true, nickname: true, userName: true,
        profile: { select: { level: true } },
      },
    });
    const userMap = new Map(buddyUsers.map(u => [u.userId, u]));

    return {
      buddies: items.map(b => {
        const u = userMap.get(b.buddyId);
        const d = b.lastDiveDate;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return {
          userId: b.buddyId,
          nickname: u?.nickname ?? '',
          name: u?.userName ?? null,
          level: u?.profile?.level ?? '0',
          lastDiveDate: dateStr,
        };
      }),
      hasMore,
    };
  }

  async getStudents(instructorUserId: string) {
    const blockedIds = await this.getBlockedIds(instructorUserId);
    // 내가 강사인 일정의 참석자 중 교육 카테고리인 것
    const participants = await this.prisma.schedule_participant.findMany({
      where: {
        userId: { not: null },
        schedule: {
          instructorId: instructorUserId,
          categoryCode: { in: ['EXPERIENCE', 'CERTIFICATION', 'LECTURE'] },
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    const studentUserIds = participants.map(p => p.userId!).filter(id => id !== instructorUserId && !blockedIds.has(id));
    if (studentUserIds.length === 0) return { students: [] };

    // 친한친구 메모 조회
    const closeFriends = await this.prisma.close_friend.findMany({
      where: { userId: instructorUserId, friendId: { in: studentUserIds } },
    });
    const memoMap = new Map(closeFriends.map(f => [f.friendId, f.memo]));

    const users = await this.prisma.user.findMany({
      where: { userId: { in: studentUserIds } },
      select: {
        userId: true, nickname: true, userName: true,
        profile: { select: { level: true } },
        licenses: { where: { status: 'IN_PROGRESS' }, select: { license: { select: { nameKo: true, name: true } } }, take: 1 },
      },
    });

    return {
      students: users.map(u => ({
        userId: u.userId,
        nickname: u.nickname,
        name: u.userName ?? null,
        level: u.profile?.level ?? '0',
        memo: memoMap.get(u.userId) ?? '',
        licenseName: u.licenses[0]?.license?.nameKo ?? u.licenses[0]?.license?.name ?? null,
      })),
    };
  }

  async getInstructors(userUserId: string) {
    const blockedIds = await this.getBlockedIds(userUserId);
    // 내가 참석자인 일정의 강사 중 교육 카테고리인 것
    const schedules = await this.prisma.schedule_participant.findMany({
      where: {
        userId: userUserId,
        schedule: {
          categoryCode: { in: ['EXPERIENCE', 'CERTIFICATION', 'LECTURE'] },
        },
      },
      select: { schedule: { select: { instructorId: true } } },
    });

    const instructorIds = [...new Set(schedules.map(s => s.schedule.instructorId))].filter(id => id !== userUserId && !blockedIds.has(id));
    if (instructorIds.length === 0) return { instructors: [] };

    const closeFriends = await this.prisma.close_friend.findMany({
      where: { userId: userUserId, friendId: { in: instructorIds } },
    });
    const memoMap = new Map(closeFriends.map(f => [f.friendId, f.memo]));

    const users = await this.prisma.user.findMany({
      where: { userId: { in: instructorIds } },
      select: {
        userId: true, nickname: true, userName: true,
        profile: { select: { level: true } },
        licenses: { where: { status: 'IN_PROGRESS' }, select: { license: { select: { nameKo: true, name: true } } }, take: 1 },
      },
    });

    return {
      instructors: users.map(u => ({
        userId: u.userId,
        nickname: u.nickname,
        name: u.userName ?? null,
        level: u.profile?.level ?? '0',
        memo: memoMap.get(u.userId) ?? '',
        licenseName: u.licenses[0]?.license?.nameKo ?? u.licenses[0]?.license?.name ?? null,
      })),
    };
  }

  async getCloseFriends(userId: string) {
    const friends = await this.prisma.close_friend.findMany({
      where: { userId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        friend: {
          select: {
            userId: true, nickname: true, userName: true,
            profile: { select: { level: true } },
            licenses: { where: { status: 'IN_PROGRESS' }, select: { license: { select: { nameKo: true, name: true } } }, take: 1 },
          },
        },
      },
    });

    return {
      friends: friends.filter(f => f.friend).map(f => ({
        userId: f.friend!.userId,
        nickname: f.friend!.nickname,
        name: f.friend!.userName ?? null,
        level: f.friend!.profile?.level ?? '0',
        memo: f.memo,
        pinned: f.pinned === 1,
        licenseName: f.friend!.licenses[0]?.license?.nameKo ?? f.friend!.licenses[0]?.license?.name ?? null,
      })),
    };
  }

  async addCloseFriend(userId: string, friendId: string) {
    if (!friendId?.toString().trim()) {
      return { success: false, message: 'friendId는 필수입니다.' };
    }

    // friendId가 숫자(user.id INT)인 경우 user.userId(VARCHAR)로 변환
    let resolvedFriendId = friendId.toString().trim();
    if (/^\d+$/.test(resolvedFriendId)) {
      const friend = await this.prisma.user.findUnique({
        where: { id: Number(resolvedFriendId) },
        select: { userId: true },
      });
      if (!friend) {
        return { success: false, message: '존재하지 않는 사용자입니다.' };
      }
      resolvedFriendId = friend.userId;
    }

    if (userId === resolvedFriendId) {
      return { success: false, message: '자기 자신을 추가할 수 없습니다.' };
    }

    const existing = await this.prisma.close_friend.findUnique({
      where: { userId_friendId: { userId, friendId: resolvedFriendId } },
    });
    if (existing) {
      return { success: false, message: '이미 친한친구입니다.' };
    }

    await this.prisma.close_friend.create({
      data: { userId, friendId: resolvedFriendId },
    });
    return { success: true };
  }

  async removeCloseFriend(userId: string, friendId: string) {
    await this.prisma.close_friend.deleteMany({
      where: { userId, friendId },
    });
    return { success: true };
  }

  async toggleCloseFriendPin(userId: string, friendId: string, pinned: boolean) {
    await this.prisma.close_friend.update({
      where: { userId_friendId: { userId, friendId } },
      data: { pinned: pinned ? 1 : 0 },
    });
    return { success: true };
  }

  async updateCloseFriendMemo(userId: string, friendId: string, memo: string) {
    await this.prisma.close_friend.update({
      where: { userId_friendId: { userId, friendId } },
      data: { memo: memo?.trim() ?? '' },
    });
    return { success: true };
  }

  async getBlockedUsers(userId: string) {
    const blocked = await this.prisma.blocked_user.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (blocked.length === 0) return { users: [] };

    const users = await this.prisma.user.findMany({
      where: { userId: { in: blocked.map(b => b.blockedId) } },
      select: {
        userId: true, nickname: true, userName: true,
        profile: { select: { level: true } },
      },
    });
    const userMap = new Map(users.map(u => [u.userId, u]));

    return {
      users: blocked.map(b => {
        const u = userMap.get(b.blockedId);
        return {
          userId: b.blockedId,
          nickname: u?.nickname ?? '',
          name: u?.userName ?? null,
          level: u?.profile?.level ?? '0',
        };
      }),
    };
  }

  async blockUser(userId: string, blockedId: string) {
    if (!blockedId?.trim()) {
      return { success: false, message: 'blockedId는 필수입니다.' };
    }
    if (userId === blockedId) {
      return { success: false, message: '자기 자신을 차단할 수 없습니다.' };
    }

    const existing = await this.prisma.blocked_user.findUnique({
      where: { userId_blockedId: { userId, blockedId } },
    });
    if (existing) {
      return { success: false, message: '이미 차단된 유저입니다.' };
    }

    await this.prisma.blocked_user.create({
      data: { userId, blockedId },
    });

    // 친한친구에서도 제거
    await this.prisma.close_friend.deleteMany({
      where: { userId, friendId: blockedId },
    });
    return { success: true };
  }

  async unblockUser(userId: string, blockedId: string) {
    await this.prisma.blocked_user.deleteMany({
      where: { userId, blockedId },
    });
    return { success: true };
  }

  async createDebriefing(body: { scheduleId: number; participantId: number; content: string }, createdBy: number) {
    const { scheduleId, participantId, content } = body;

    if (!scheduleId || !participantId) {
      return { success: false, message: '필수 항목을 입력해주세요.' };
    }

    await this.prisma.debriefing.create({
      data: {
        scheduleId,
        participantId,
        content: content?.trim() ?? '',
        createdBy,
      },
    });

    return { success: true };
  }

  async getInquiries(userId: string) {
    const inquiries = await this.prisma.inquiry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      inquiries: inquiries.map(i => ({
        id: i.id,
        title: i.title,
        content: i.content,
        status: i.status,
        answer: i.answer ?? null,
        answeredAt: i.answeredAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  async getInquiryDetail(id: number, userId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      include: { attachment: true },
    });

    if (!inquiry) {
      return { success: false, message: '존재하지 않는 문의입니다.' };
    }
    if (inquiry.userId !== userId) {
      return { success: false, message: '조회 권한이 없습니다.' };
    }

    return {
      inquiry: {
        id: inquiry.id,
        title: inquiry.title,
        content: inquiry.content,
        status: inquiry.status,
        answer: inquiry.answer ?? null,
        answeredAt: inquiry.answeredAt?.toISOString() ?? null,
        createdAt: inquiry.createdAt.toISOString(),
        attachment: inquiry.attachment
          ? {
              id: inquiry.attachment.id,
              fileUrl: inquiry.attachment.fileUrl,
              fileName: inquiry.attachment.fileName,
              fileSize: inquiry.attachment.fileSize,
              mimeType: inquiry.attachment.mimeType,
            }
          : null,
      },
    };
  }

  async createInquiry(userId: string, body: { title: string; content: string }, file?: Express.Multer.File) {
    if (!body.title?.trim()) {
      return { success: false, message: '제목을 입력해주세요.' };
    }
    if (!body.content?.trim()) {
      return { success: false, message: '내용을 입력해주세요.' };
    }

    const inquiry = await this.prisma.inquiry.create({
      data: {
        userId,
        title: body.title.trim(),
        content: body.content.trim(),
      },
    });

    if (file) {
      const key = `allblue/inquiries/${inquiry.id}/${randomUUID()}_${file.originalname}`;
      const isImage = file.mimetype.startsWith('image/');
      let fileUrl = await this.s3.uploadFile(
        file.buffer,
        key,
        file.mimetype,
        isImage ? undefined : `attachment; filename="${encodeURIComponent(file.originalname)}"`,
      );

      if (!fileUrl) {
        const uploadDir = path.join(process.cwd(), 'uploads', 'inquiries', String(inquiry.id));
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const fallbackName = `${randomUUID()}_${file.originalname}`;
        fs.writeFileSync(path.join(uploadDir, fallbackName), file.buffer);
        const baseUrl = this.config.get<string>('BASE_URL', 'https://api.rumbaugh.co.kr');
        fileUrl = `${baseUrl}/allblue/uploads/inquiries/${inquiry.id}/${fallbackName}`;
      }

      await this.prisma.inquiry_attachment.create({
        data: {
          inquiryId: inquiry.id,
          fileUrl,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      });
    }

    return { success: true };
  }

  async deleteInquiry(id: number, userId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      include: { attachment: true },
    });

    if (!inquiry) {
      return { success: false, message: '존재하지 않는 문의입니다.' };
    }
    if (inquiry.userId !== userId) {
      return { success: false, message: '삭제 권한이 없습니다.' };
    }

    // S3 파일 삭제
    if (inquiry.attachment) {
      const s3Key = this.s3.extractKeyFromUrl(inquiry.attachment.fileUrl);
      if (s3Key) await this.s3.deleteFiles([s3Key]);
    }

    await this.prisma.inquiry.delete({ where: { id } });

    return { success: true };
  }

  async withdraw(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) {
      return { success: false, message: '존재하지 않는 사용자입니다.' };
    }

    await this.prisma.$transaction([
      // userId (String FK) 참조 테이블
      this.prisma.inquiry.deleteMany({ where: { userId } }),
      this.prisma.close_friend.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } }),
      this.prisma.blocked_user.deleteMany({ where: { OR: [{ userId }, { blockedId: userId }] } }),
      this.prisma.dive_buddy.deleteMany({ where: { OR: [{ userId }, { buddyId: userId }] } }),
      this.prisma.schedule_participant.deleteMany({ where: { userId } }),
      this.prisma.user_license.deleteMany({ where: { OR: [{ userId }, { instructorId: userId }] } }),
      // user.id (Int FK) 참조 테이블
      this.prisma.login_history.deleteMany({ where: { userId: user.id } }),
      this.prisma.cert_request.deleteMany({ where: { userId: user.id } }),
      this.prisma.user_license_achievement.deleteMany({ where: { OR: [{ userId: user.id }, { completedBy: user.id }] } }),
      this.prisma.user_profile.deleteMany({ where: { userId: user.id } }),
      // user 삭제
      this.prisma.user.delete({ where: { userId } }),
    ]);

    return { success: true };
  }

  private async checkAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { userId },
      select: { profile: { select: { level: true } } },
    });
    return user?.profile?.level === 'A';
  }

  async getInquiryPendingCount(userId: string) {
    if (!(await this.checkAdmin(userId))) {
      return { success: false, message: '관리자 권한이 필요합니다.' };
    }

    const count = await this.prisma.inquiry.count({
      where: { status: 'PENDING' },
    });

    return { count };
  }

  async getAllInquiries(userId: string) {
    if (!(await this.checkAdmin(userId))) {
      return { success: false, message: '관리자 권한이 필요합니다.' };
    }

    const inquiries = await this.prisma.inquiry.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [...new Set(inquiries.map(i => i.userId))];
    const users = await this.prisma.user.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, userName: true },
    });
    const userMap = new Map(users.map(u => [u.userId, u.userName]));

    return {
      inquiries: inquiries.map(i => ({
        id: i.id,
        userId: i.userId,
        userName: userMap.get(i.userId) ?? null,
        title: i.title,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  async answerInquiry(id: number, answer: string, userId: string) {
    if (!(await this.checkAdmin(userId))) {
      return { success: false, message: '관리자 권한이 필요합니다.' };
    }
    if (!answer?.trim()) {
      return { success: false, message: '답변 내용을 입력해주세요.' };
    }

    const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) {
      return { success: false, message: '존재하지 않는 문의입니다.' };
    }

    await this.prisma.inquiry.update({
      where: { id },
      data: {
        answer: answer.trim(),
        status: 'ANSWERED',
        answeredAt: new Date(),
      },
    });

    return { success: true };
  }

  async sendVerificationCode(phone: string) {
    if (!phone?.trim() || !/^\d{10,11}$/.test(phone.trim())) {
      return { success: false, message: '전화번호를 올바르게 입력해주세요.' };
    }

    const cleanPhone = phone.trim();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // 기존 코드 삭제 후 새로 생성
    await this.prisma.verification_code.deleteMany({ where: { phone: cleanPhone } });
    await this.prisma.verification_code.create({
      data: { phone: cleanPhone, code, expiresAt },
    });

    // AWS SNS로 SMS 발송
    try {
      await this.snsClient.send(new PublishCommand({
        PhoneNumber: '+82' + cleanPhone.slice(1),
        Message: `[AllBlue] 인증번호: ${code}`,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional',
          },
        },
      }));
    } catch (err) {
      console.error('[SMS] 발송 실패:', err);
      return { success: false, message: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' };
    }

    return { success: true };
  }

  async verifyCode(phone: string, code: string) {
    if (!phone?.trim() || !code?.trim()) {
      return { success: false, message: '전화번호와 인증번호를 입력해주세요.' };
    }

    const record = await this.prisma.verification_code.findFirst({
      where: { phone: phone.trim(), code: code.trim() },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      return { success: false, message: '인증번호가 일치하지 않습니다.' };
    }

    if (record.expiresAt < new Date()) {
      return { success: false, message: '인증번호가 만료되었습니다. 다시 요청해주세요.' };
    }

    await this.prisma.verification_code.deleteMany({ where: { phone: phone.trim() } });

    return { success: true };
  }

  async getCodes(group: string) {
    if (!group?.trim()) {
      return { success: false, message: 'group 파라미터는 필수입니다.' };
    }

    const codes = await this.prisma.common_code.findMany({
      where: { codeGroup: group.trim(), isActive: 1 },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, nameKo: true, extraValue: true, sortOrder: true },
    });

    return { success: true, data: codes };
  }

  async getAssociations() {
    const associations = await this.prisma.association.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, code: true, name: true, nameKo: true, fullName: true,
        country: true, foundedYear: true, website: true, sortOrder: true,
      },
    });
    return { success: true, data: associations };
  }

  async getLicenses(associationCode?: string) {
    const where: any = {};
    if (associationCode) {
      const assoc = await this.prisma.association.findUnique({ where: { code: associationCode } });
      if (!assoc) return { success: false, message: '존재하지 않는 협회입니다.' };
      where.associationId = assoc.id;
    }

    const licenses = await this.prisma.license.findMany({
      where,
      orderBy: [{ association: { sortOrder: 'asc' } }, { levelOrder: 'asc' }],
      select: {
        id: true, code: true, name: true, nameKo: true, levelOrder: true,
        isInstructor: true, note: true,
        association: { select: { code: true, name: true, nameKo: true } },
      },
    });
    return { success: true, data: licenses };
  }

  async getLicenseRequirements(code: string) {
    const license = await this.prisma.license.findFirst({
      where: { code },
      select: { id: true, code: true, name: true, nameKo: true },
    });

    if (!license) {
      return { success: false, message: '존재하지 않는 라이센스입니다.' };
    }

    const requirements = await this.prisma.license_requirement.findMany({
      where: { licenseId: license.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, parentId: true, reqGroup: true, reqType: true, code: true,
        name: true, nameKo: true, unit: true,
        minValue: true, maxValue: true, displayValue: true,
        isOptional: true, sourceType: true, sortOrder: true, note: true,
      },
    });

    return {
      success: true,
      data: {
        license,
        requirements: requirements.map(r => ({
          ...r,
          minValue: r.minValue ? Number(r.minValue) : null,
          maxValue: r.maxValue ? Number(r.maxValue) : null,
        })),
      },
    };
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
      include: { user: { select: { userId: true, nickname: true, userName: true, birthDate: true } } },
    });

    return {
      requests: requests.map(r => ({
        id: r.id,
        userId: r.user.userId,
        nickname: r.user.nickname,
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
            nickname: request.name,
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
    const { nickname, birthDate, phone, kakaoTalkId, instagramId } = body;

    if (!nickname?.trim()) {
      return { error: 'VALIDATION_ERROR', message: '닉네임을 입력해주세요.' };
    }

    // birthDate 검증 (선택)
    if (birthDate?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) {
      return { error: 'VALIDATION_ERROR', message: '생년월일 형식이 올바르지 않습니다.' };
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
        nickname: nickname.trim(),
        email: decoded.email,
        phone: phone?.trim() || null,
        kakaoId: decoded.kakaoId ?? null,
        googleId: decoded.googleId ?? null,
        naverId: decoded.naverId ?? null,
        appleId: decoded.appleId ?? null,
        profileImage: decoded.profileImage,
        birthDate: birthDate?.trim() || null,
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
        nickname: user.nickname,
        name: user.userName ?? null,
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
        nickname: existingUser.nickname,
        name: existingUser.userName ?? null,
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
        nickname: existingUser.nickname,
        name: existingUser.userName ?? null,
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
        nickname: existingUser.nickname,
        name: existingUser.userName ?? null,
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
        nickname: existingUser.nickname,
        name: existingUser.userName ?? null,
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
