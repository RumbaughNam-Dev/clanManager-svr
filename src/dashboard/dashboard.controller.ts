// src/dashboard/dashboard.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Post
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
    return this.svc.listBossesForClan(clanId); // 래핑 없이 그대로
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
    @Body() body: { cutAtIso: string; looterLoginId?: string|null; items?: string[]; mode:'DISTRIBUTE'|'TREASURY'; participants?: string[]; imageFileName?: string }
  ) {
    const clanId = req.user?.clanId;
    const actorLoginId = req.user?.loginId ?? 'system';
    if (!clanId) {
      throw new BadRequestException('혈맹 정보가 없습니다.');
    }
    return this.svc.cutBoss(clanId, bossMetaId, body, actorLoginId);
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
}