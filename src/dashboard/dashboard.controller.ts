import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Patch,
  Param,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Express } from 'express';
import { JwtOptionalAuthGuard } from 'src/auth/jwt-optional.guard';

@Controller('v1/dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  /**
   * 보스 목록
   * - 로그인 여부에 따라 clanId가 있을 수 있음
   * - 응답: { ok: true, serverTime: string, bosses: [...] }
   */
  @UseGuards(JwtOptionalAuthGuard)
  @Post('bosses')
  async list(@Req() req: any) {
    const clanId = req.user?.clanId ?? null;
    return this.svc.listBossesForClan(clanId);
  }

  /**
   * 컷 저장 (JSON 바디)
   * 프론트는 먼저 /v1/dashboard/upload 로 이미지 업로드 → fileName을 받아
   * 여기 body.imageFileName 에 넣어 호출.
   */
  @UseGuards(JwtAuthGuard)
  @Post('bosses/:id/cut')
  async cutBoss(
    @Req() req: any,
    @Param('id') bossMetaId: string,
    @Body()
    body: {
      cutAtIso?: string;                       // 프론트에서 안 보내면 서버시간으로 대체
      force?: boolean;
      looterLoginId?: string | null;           // 레거시 공통 루팅자(옵션)
      items?: string[];                        // 레거시: 아이템 이름 배열
      lootUsers?: Array<string | null>;        // 레거시: 인덱스 매칭 루팅자 배열 (서비스에 굳이 안 넘겨도 됨)
      itemsEx?: {                              // 신규: per-item (프론트는 itemName을 보냄)
        itemName: string;
        lootUserId?: string | null;
      }[];
      mode: 'DISTRIBUTE' | 'TREASURY';
      participants?: string[];
      imageFileName?: string;
    }
  ) {
    const clanId = req.user?.clanId;
    const actorLoginId = req.user?.loginId ?? 'system';
    if (!clanId) {
      throw new BadRequestException('혈맹 정보가 없습니다.');
    }

    // 1) cutAtIso: 서비스는 string 필수 → 기본값으로 서버 시간 보정
    const cutAtIso = body.cutAtIso ?? new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });;

    // 2) itemsEx: 서비스는 name 필드 기대 → itemName → name 으로 매핑
    const itemsEx =
      Array.isArray(body.itemsEx)
        ? body.itemsEx
            .map(r => ({
              name: (r?.itemName ?? '').trim(),             // ← 필드명 변환
              lootUserId: (r?.lootUserId ?? null) || null,  // 그대로 통과(문자열 또는 null)
            }))
            .filter(r => !!r.name)
        : undefined;

    // 3) 서비스 시그니처에 맞는 페이로드 구성 (lootUsers는 넘기지 않아도 서비스 쪽 로직에 지장 없음)
    const payloadForSvc = {
      cutAtIso,                                 // ✅ 필수 문자열
      force: body.force === true,
      looterLoginId: body.looterLoginId ?? null,
      items: body.items,                        // (레거시) 있으면 전달
      itemsEx,                                  // (신규) 정규화된 배열
      mode: body.mode,
      participants: body.participants,
      imageFileName: body.imageFileName,
      actorLoginId,                             // 누가 기록했는지
    };

    return this.svc.cutBoss(String(clanId), bossMetaId, payloadForSvc, actorLoginId);
  }

  /**
   * 이미지 업로드 (멀터)
   * - 경로: Post, /v1/dashboard/upload
   * - 필드명: file
   * - 응답: { ok: true, fileName: string }
   */
  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: path.resolve(process.cwd(), 'uploads'),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          const name = crypto.randomBytes(16).toString('hex') + ext;
          cb(null, name);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    return { ok: true, fileName: file.filename };
  }

  @UseGuards(JwtAuthGuard)
  @Post('bosses/:id/daze')
  async incDaze(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { clanId?: string | number; atIso?: string; force?: boolean },
  ) {
    // JWT에서 clanId 꺼내는 방식은 프로젝트 컨벤션대로
    const clanId = req.user?.clanId ?? body?.clanId;
    const actorLoginId = req.user?.loginId ?? 'system';
    return this.svc.incDazeByBossMeta(clanId, id, actorLoginId, {
      atIso: body?.atIso,
      force: body?.force === true,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('import-discord')
  async importDiscord(
    @Req() req: any,
    @Body() body: { text: string },
  ) {
    const clanIdRaw = req.user?.clanId;
    const actorLoginId = req.user?.loginId ?? 'system';
    if (!clanIdRaw) throw new BadRequestException('혈맹 정보가 없습니다.');
    if (!body?.text) throw new BadRequestException('text가 필요합니다.');

    const clanId = BigInt(clanIdRaw);   // ✅ string → bigint 변환
    return this.svc.importDiscord(clanId, actorLoginId, body.text);
  }

   /**
    * 컷 타임라인 업데이트 (사후 정보 입력/수정)
    */
   @UseGuards(JwtAuthGuard)
   @Patch('boss-timelines/:id')
   async updateBossTimeline(
     @Req() req: any,
     @Param('id') timelineId: string,
     @Body() body: {
       cutAtIso?: string;
       mode?: 'DISTRIBUTE' | 'TREASURY';
       itemsEx?: { itemName: string; lootUserId?: string | null }[];
       participants?: string[];
       imageFileName?: string;
     },
   ) {
     const clanId = req.user?.clanId;
     const actorLoginId = req.user?.loginId ?? 'system';
     if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');
     return this.svc.updateBossTimeline(String(clanId), timelineId, body, actorLoginId);
   }

  @UseGuards(JwtAuthGuard)
  @Post('boss-timelines/:id')               // ✅ POST 알리아스
  async updateBossTimelineByPost(
    @Req() req: any,
    @Param('id') timelineId: string,
    @Body() body: {
      cutAtIso?: string;
      mode?: 'DISTRIBUTE' | 'TREASURY';
      itemsEx?: { itemName: string; lootUserId?: string | null }[];
      participants?: string[];
      imageFileName?: string;
    },
  ) {
    const clanId = req.user?.clanId;
    const actorLoginId = req.user?.loginId ?? 'system';
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');
    return this.svc.updateBossTimeline(String(clanId), timelineId, body, actorLoginId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('boss-timelines/latest-id')
  async latestTimelineId(
    @Req() req: any,
    @Body() body: { bossName: string; preferEmpty?: boolean },
  ) {
     const clanId = req.user?.clanId;
     if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');
     if (!body?.bossName) throw new BadRequestException('bossName이 필요합니다.');
    return this.svc.latestTimelineIdForBoss(String(clanId), body.bossName, !!body.preferEmpty);
  }
}
