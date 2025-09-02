import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ClanRequestsService {
  constructor(private prisma: PrismaService) {}

  async create(input: {
    world: string;
    serverNo: number;
    clanName: string;
    loginId: string;
    password: string;
    depositor: string;
  }) {
    const passwordHash = await bcrypt.hash(input.password, 10);

    // ✅ 1) 사전 중복 체크: "같은 서버 내 혈맹명" → 우선적으로 검사
    const dupClan = await this.prisma.clanRequest.findFirst({
      where: {
        world: input.world,
        serverNo: input.serverNo,
        clanName: input.clanName,
      },
      select: { id: true },
    });
    if (dupClan) {
      throw new ConflictException({
        ok: false,
        code: 'DUP_CLAN_NAME',
        message: '같은 서버에 이미 존재하는 혈맹명입니다.',
      });
    }

    // ✅ 2) 사전 중복 체크: "같은 서버 내 로그인ID"
    const dupLogin = await this.prisma.clanRequest.findFirst({
      where: {
        world: input.world,
        serverNo: input.serverNo,
        loginId: input.loginId,
      },
      select: { id: true },
    });
    if (dupLogin) {
      throw new ConflictException({
        ok: false,
        code: 'DUP_LOGIN_ID',
        message: '같은 서버에 이미 존재하는 로그인ID입니다.',
      });
    }

    // ✅ 3) 생성 (동시에 들어오는 경쟁 상황에 대비해 P2002도 백업 처리)
    try {
      const created = await this.prisma.clanRequest.create({
        data: {
          world: input.world,
          serverNo: input.serverNo,
          clanName: input.clanName,
          loginId: input.loginId,
          passwordHash,
          depositorName: input.depositor,
        },
        select: { id: true, status: true, createdAt: true },
      });

      return {
        ok: true,
        data: {
          id: String(created.id),
          status: created.status,
          createdAt: created.createdAt,
        },
      };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // 동시 요청 등으로 유니크 제약이 마지막에 걸렸을 때 백업 메시지
        return this.handleP2002Fallback(e);
      }
      throw e;
    }
  }

  // P2002 백업 핸들러 (가능한 한 의미 있는 메시지로 매핑)
  private handleP2002Fallback(e: any) {
    const raw = e?.meta?.target;
    // Prisma 버전에 따라 배열/문자열/undefined 등 다양. 최대한 구분 시도.
    const arr = Array.isArray(raw) ? raw.map(String) : [];
    const s = typeof raw === 'string' ? raw : '';

    // 모델 필드명 기준
    const hasClanKey = (arr.length && ['world','serverNo','clanName'].every(f => arr.includes(f)))
                    || (s.includes('clan') && s.includes('world'));
    const hasLoginKey = (arr.length && ['world','serverNo','loginId'].every(f => arr.includes(f)))
                     || (s.includes('login') && s.includes('world'));

    if (hasClanKey) {
      throw new ConflictException({
        ok: false,
        code: 'DUP_CLAN_NAME',
        message: '같은 서버에 이미 존재하는 혈맹명입니다.',
      });
    }
    if (hasLoginKey) {
      throw new ConflictException({
        ok: false,
        code: 'DUP_LOGIN_ID',
        message: '같은 서버에 이미 존재하는 로그인ID입니다.',
      });
    }
    throw new ConflictException({
      ok: false,
      code: 'DUP_UNKNOWN',
      message: '이미 존재하는 값입니다.',
    });
  }
}