import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type ReqStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

@Injectable()
export class AdminClanRequestsService {
  constructor(private prisma: PrismaService) {}

  async listAll() {
    const pending = await this.prisma.clanRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        world: true,
        serverNo: true,
        clanName: true,
        depositorName: true,
        createdAt: true,
        status: true,
      },
    });

    const processed = await this.prisma.clanRequest.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED'] } },
      orderBy: { reviewedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        world: true,
        serverNo: true,
        clanName: true,
        depositorName: true,
        createdAt: true,
        status: true,
      },
    });

    return { ok: true, pending, processed };
  }

  async updateStatus(id: bigint, status: ReqStatus, note?: string) {
    if (status === 'APPROVED') {
      return this.approve(id, note);
    }
    if (status === 'REJECTED') {
      const updated = await this.prisma.clanRequest.update({
        where: { id },
        data: { status: 'REJECTED', reviewerNote: note ?? null, reviewedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) },
        select: { id: true, status: true },
      });
      return { ok: true, data: { id: String(updated.id), status: updated.status } };
    }
    throw new BadRequestException('invalid status');
  }

  /** 승인 시: clan 생성(or upsert) → user upsert(ADMIN) → 요청 상태 갱신 */
  private async approve(id: bigint, note?: string) {
    const req = await this.prisma.clanRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        world: true,
        serverNo: true,
        clanName: true,
        loginId: true,
        passwordHash: true,
      },
    });
    if (!req) throw new NotFoundException('요청을 찾을 수 없습니다.');
    if (req.status !== 'PENDING') throw new BadRequestException('이미 처리된 요청입니다.');

    await this.prisma.$transaction(async (tx) => {
      // 1) 혈맹 upsert (world + serverNo + name 복합 유니크)
      const clan = await tx.clan.upsert({
        where: {
          uq_world_server_name: {
            world: req.world,
            serverNo: req.serverNo,
            name: req.clanName,
          },
        },
        create: {
          world: req.world,
          serverNo: req.serverNo,
          name: req.clanName,
        },
        update: {}, // 이미 있으면 변경 없음
        select: { id: true },
      });

      // 2) 사용자 upsert (최초 등록자는 반드시 ADMIN)
      await tx.user.upsert({
        where: { loginId: req.loginId },
        create: {
          loginId: req.loginId,
          passwordHash: req.passwordHash, // 요청에 저장된 해시 그대로 사용
          role: 'ADMIN',
          clanId: clan.id,
        },
        update: {
          // 이미 존재한다면 혈맹 연결 및 관리자 권한 보장
          clanId: clan.id,
          role: 'ADMIN',
        },
      });

      // 3) 요청 상태 갱신
      await tx.clanRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewerNote: note ?? null, reviewedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) },
      });
    });

    return { ok: true, data: { id: String(id), status: 'APPROVED' as const } };
  }
}