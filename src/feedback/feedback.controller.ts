// src/feedback/feedback.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import express from 'express';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FeedbackService } from './feedback.service';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport'; 

enum FeedbackStatus {
  WRITTEN = 'WRITTEN',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
}

/** ───────────────── DTOs ───────────────── */

export class SearchFeedbackDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  myOnly?: boolean;

  @IsOptional()
  @IsString()
  authorLoginId?: string;

  // YYYY-MM-DD
  @IsOptional()
  @IsString()
  fromDate?: string;

  // YYYY-MM-DD
  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  size?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;
}

export class CreateFeedbackDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 10000)
  content!: string;
}

export class UpdateFeedbackDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10000)
  content?: string;
}

export class CommentCreateDto {
  @IsString()
  @Length(1, 5000)
  content!: string;
}

export class CommentUpdateDto {
  @IsString()
  @Length(1, 5000)
  content!: string;
}

export class ChangeStatusDto {
  /**
   * CONFIRM  → 확인완료
   * START    → 처리중
   * DONE     → 처리완료
   * REJECT   → 반려
   */
  @IsEnum(['CONFIRM', 'START', 'DONE', 'REJECT'] as const)
  action!: 'CONFIRM' | 'START' | 'DONE' | 'REJECT';
}

/** ───────────────── 유틸 ───────────────── */

function getUser(req: express.Request): { userId: bigint | null; role: string; loginId: string } {
  const raw: any = (req as any).user ?? {};
  const sub = raw?.sub ?? null;
  let userId: bigint | null = null;
  if (sub != null) {
    try { userId = BigInt(String(sub)); } catch { userId = null; }
  }
  return {
    userId,
    role: String(raw?.role ?? ''),
    loginId: String(raw?.loginId ?? ''),
  };
}

/** YYYY-MM-DD → Date(로컬 00:00) */
function parseYmd(ymd?: string): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/** 포함형 일수 차 (from~to 둘 다 포함) */
function daysBetweenInclusive(a: string, b: string): number {
  const da = parseYmd(a); const db = parseYmd(b);
  if (!da || !db) return Infinity;
  const s = Math.min(da.getTime(), db.getTime());
  const e = Math.max(da.getTime(), db.getTime());
  return Math.floor((e - s) / 86400000) + 1;
}

/** 31일 범위 검증 (둘 다 주어졌을 때만) */
function assertRangeWithin31(from?: string, to?: string) {
  if (from && to) {
    if (daysBetweenInclusive(from, to) > 31) {
      throw new BadRequestException('검색 기간은 최대 31일까지만 가능합니다.');
    }
  }
}

/** 권한 체크 헬퍼 */
function isSuperAdmin(role: string) {
  return role === 'SUPERADMIN';
}

/** ───────────────── Controller ───────────────── */

@Controller('/v1/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * 목록 검색
   * - title / myOnly / authorLoginId
   * - fromDate ~ toDate (YYYY-MM-DD) — 31일 제한
   * - 페이지네이션 (page, size)
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('/search')
  async search(@Body() dto: SearchFeedbackDto, @Req() req: express.Request) {
    const { userId, role, loginId } = getUser(req);

    // 31일 범위 제한
    assertRangeWithin31(dto.fromDate, dto.toDate);

    // myOnly가 true면 authorLoginId는 무시하고 자신의 글만
    const effectiveAuthorLoginId =
      dto.myOnly ? loginId : (dto.authorLoginId ?? undefined);

    return this.feedbackService.search({
      title: dto.title?.trim() || undefined,
      authorLoginId: effectiveAuthorLoginId?.trim() || undefined,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      page: dto.page ?? 1,
      size: dto.size ?? 50,
      viewer: { userId, role, loginId },
    });
  }

  /** 작성 */
  @UseGuards(AuthGuard('jwt'))
  @Post()
  async create(@Body() dto: CreateFeedbackDto, @Req() req: express.Request) {
    const { userId, loginId } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');
    return this.feedbackService.create({
      authorId: userId,
      title: dto.title.trim(),
      content: dto.content.trim(),
      authorLoginId: loginId,
    });
  }

  /** 상세 조회 (댓글 포함, 삭제표시 포함) */
  @UseGuards(AuthGuard('jwt'))
  @Post(':id')
  async detail(@Param('id') id: string, @Req() req: express.Request) {
    const fid = (() => { try { return BigInt(id); } catch { return null; } })();
    if (!fid) throw new BadRequestException('id 형식이 올바르지 않습니다.');

    const { userId, role } = getUser(req);
    const row = await this.feedbackService.findById(fid, { userId, role });
    if (!row) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    return row;
  }

  /** 수정 (본인 글 & 처리 시작 전) */
  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackDto,
    @Req() req: express.Request,
  ) {
    const fid = (() => { try { return BigInt(id); } catch { return null; } })();
    if (!fid) throw new BadRequestException('id 형식이 올바르지 않습니다.');
    const { userId, role } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');

    return this.feedbackService.update(fid, {
      title: dto.title?.trim(),
      content: dto.content?.trim(),
      actor: { userId, role },
    });
  }

  /** 소프트 삭제 (본인 글 & 처리 시작 전, 슈퍼관리자는 무제한) */
  @UseGuards(AuthGuard('jwt'))
  @Post(':id/delete')
  async softDelete(@Param('id') id: string, @Req() req: express.Request) {
    const fid = (() => { try { return BigInt(id); } catch { return null; } })();
    if (!fid) throw new BadRequestException('id 형식이 올바르지 않습니다.');
    const { userId, role } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');

    return this.feedbackService.softDelete(fid, { userId, role });
  }

  /**
   * 상태 변경 (슈퍼관리자 전용)
   * - action: CONFIRM → 확인완료
   * - action: START   → 처리중
   * - action: DONE    → 처리완료
   * - action: REJECT  → 반려
   */
  @UseGuards(AuthGuard('jwt'))
  @Post(':id/status')
  async changeStatus(
    @Param('id') id: string,
    @Body() body: ChangeStatusDto,
    @Req() req: express.Request,
  ) {
    const fid = (() => { try { return BigInt(id); } catch { return null; } })();
    if (!fid) throw new BadRequestException('id 형식이 올바르지 않습니다.');
    const { userId, role } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');
    if (!isSuperAdmin(role)) throw new BadRequestException('권한이 없습니다.');

    const next = (() => {
      switch (body.action) {
        case 'CONFIRM': return FeedbackStatus.CONFIRMED;
        case 'START':   return FeedbackStatus.IN_PROGRESS;
        case 'DONE':    return FeedbackStatus.DONE;
        case 'REJECT':  return FeedbackStatus.REJECTED;
        default: throw new BadRequestException('잘못된 action');
      }
    })();

    return this.feedbackService.changeStatus(fid, {
      nextStatus: next,
      handledById: userId,
    });
  }

  /** 댓글 작성 (처리 시작 전, 슈퍼관리자는 제한 없음) */
  @UseGuards(AuthGuard('jwt'))
  @Post(':id/comments')
  async addComment(
    @Param('id') id: string,
    @Body() dto: CommentCreateDto,
    @Req() req: express.Request,
  ) {
    const fid = (() => { try { return BigInt(id); } catch { return null; } })();
    if (!fid) throw new BadRequestException('id 형식이 올바르지 않습니다.');
    const { userId, role, loginId } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');

    return this.feedbackService.addComment(fid, {
      authorId: userId,
      authorLoginId: loginId,
      content: dto.content.trim(),
      actorRole: role,
    });
  }

  /** 댓글 수정 (본인 댓글 & 처리 시작 전, 슈퍼관리자는 무제한) */
  @UseGuards(AuthGuard('jwt'))
  @Patch('/comments/:commentId')
  async updateComment(
    @Param('commentId') commentId: string,
    @Body() dto: CommentUpdateDto,
    @Req() req: express.Request,
  ) {
    const cid = (() => { try { return BigInt(commentId); } catch { return null; } })();
    if (!cid) throw new BadRequestException('commentId 형식이 올바르지 않습니다.');
    const { userId, role } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');

    return this.feedbackService.updateComment(cid, {
      content: dto.content.trim(),
      actor: { userId, role },
    });
  }

  /** 댓글 소프트 삭제 (본인 댓글 & 처리 시작 전, 슈퍼관리자는 무제한) */
  @UseGuards(AuthGuard('jwt'))
  @Post('/comments/:commentId/delete')
  async deleteComment(
    @Param('commentId') commentId: string,
    @Req() req: express.Request,
  ) {
    const cid = (() => { try { return BigInt(commentId); } catch { return null; } })();
    if (!cid) throw new BadRequestException('commentId 형식이 올바르지 않습니다.');
    const { userId, role } = getUser(req);
    if (!userId) throw new BadRequestException('로그인이 필요합니다.');

    return this.feedbackService.softDeleteComment(cid, { userId, role });
  }
}