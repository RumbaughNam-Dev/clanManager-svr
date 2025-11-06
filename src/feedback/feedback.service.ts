// src/feedback/feedback.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export enum FeedbackStatus {
  WRITTEN = 'WRITTEN',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
}

type Viewer = { userId: bigint | null; role: string; loginId?: string };

function isSuperAdmin(role?: string) {
  return role === 'SUPERADMIN';
}

function parseYmd(ymd?: string): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}
function daysBetweenInclusive(a?: string, b?: string) {
  const da = parseYmd(a); const db = parseYmd(b);
  if (!da || !db) return Infinity;
  const s = Math.min(da.getTime(), db.getTime());
  const e = Math.max(db.getTime(), da.getTime());
  return Math.floor((e - s) / 86400000) + 1;
}

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────
  // 목록 검색
  // ───────────────────────────────────────────────────────────
  async search(args: {
    title?: string;
    authorLoginId?: string;
    fromDate?: string; // YYYY-MM-DD
    toDate?: string;   // YYYY-MM-DD
    page: number;
    size: number;
    viewer: Viewer;
  }) {
    const { title, authorLoginId, fromDate, toDate, page, size } = args;

    // 31일 방어 (이중 체크)
    if (fromDate && toDate && daysBetweenInclusive(fromDate, toDate) > 31) {
      throw new BadRequestException('검색 기간은 최대 31일까지만 가능합니다.');
    }

    const where: any = {
      // 기본: 소프트 삭제 제외
      deleted: false,
    };

    if (title) {
      where.title = { contains: title, mode: 'insensitive' as const };
    }
    if (authorLoginId) {
      // 작성자 로그인ID 검색
      where.author = { loginId: { contains: authorLoginId, mode: 'insensitive' as const } };
    }
    if (fromDate) {
      const s = parseYmd(fromDate)!;
      where.createdAt = { ...(where.createdAt ?? {}), gte: s };
    }
    if (toDate) {
      const e = parseYmd(toDate)!;
      e.setHours(23, 59, 59, 999);
      where.createdAt = { ...(where.createdAt ?? {}), lte: e };
    }

    const take = Math.min(Math.max(size, 1), 200);
    const skip = Math.max((page - 1) * take, 0);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          deleted: true,
          author: { select: { loginId: true } },
        },
      }),
    ]);

    // 목록 응답 최소 필드로 맵핑
    const items = rows.map((r) => ({
      id: String(r.id),
      title: r.deleted ? '삭제된 게시글입니다.' : r.title,
      authorLoginId: r.author?.loginId ?? '-',
      status: r.status as FeedbackStatus,
      createdAt: r.createdAt.toISOString(),
      deleted: r.deleted,
    }));

    return { ok: true, total, items, page, size: take };
  }

  // ───────────────────────────────────────────────────────────
  // 작성
  // ───────────────────────────────────────────────────────────
  async create(args: {
    authorId: bigint;
    authorLoginId: string;
    title: string;
    content: string;
  }) {
    const row = await this.prisma.feedback.create({
      data: {
        authorId: args.authorId,
        title: args.title,
        content: args.content,
        status: FeedbackStatus.WRITTEN,
      },
      select: { id: true },
    });
    return { ok: true, id: String(row.id) };
  }

  // ───────────────────────────────────────────────────────────
  // 상세 (댓글 포함)
  // - superadmin이 WRITTEN 글을 열람하면 자동으로 CONFIRMED 처리(요구사항 반영)
  // ───────────────────────────────────────────────────────────
  async findById(id: bigint, viewer: Viewer) {
    const row = await this.prisma.feedback.findUnique({
      where: { id },
      include: {
        author: { select: { loginId: true, id: true } },
        handledBy: { select: { loginId: true, id: true } },
        deletedBy: { select: { loginId: true, id: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { loginId: true, id: true } },
            deletedBy: { select: { loginId: true, id: true } },
          },
        },
      },
    });
    if (!row) return null;

    let updatedStatus = row.status;
    // superadmin이 열람 & 현재 WRITTEN 이면 확인완료로 자동 전환
    if (isSuperAdmin(viewer.role) && row.status === FeedbackStatus.WRITTEN) {
      await this.prisma.feedback.update({
        where: { id },
        data: { status: FeedbackStatus.CONFIRMED, handledById: viewer.userId ?? undefined },
      });
      updatedStatus = FeedbackStatus.CONFIRMED;
    }

    return {
      ok: true,
      id: String(row.id),
      title: row.deleted ? '삭제된 게시글입니다.' : row.title,
      content: row.deleted ? '' : row.content,
      status: updatedStatus,
      authorLoginId: row.author?.loginId ?? '-',
      deleted: row.deleted,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      comments: row.comments.map((c) => ({
        id: String(c.id),
        authorLoginId: c.author?.loginId ?? '-',
        content: c.deleted ? '삭제된 댓글입니다.' : c.content,
        deleted: c.deleted,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  // ───────────────────────────────────────────────────────────
  // 수정 (작성자만, 처리 시작 전 / superadmin 편집은 허용하지 않음)
  // ───────────────────────────────────────────────────────────
  async update(
    id: bigint,
    args: { title?: string; content?: string; actor: { userId: bigint; role: string } },
  ) {
    const curr = await this.prisma.feedback.findUnique({
      where: { id },
      select: { authorId: true, status: true, deleted: true },
    });
    if (!curr) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    if (curr.deleted) throw new BadRequestException('삭제된 게시글입니다.');
    if (curr.authorId !== args.actor.userId) {
      throw new BadRequestException('본인 게시글만 수정할 수 있습니다.');
    }
    if ([FeedbackStatus.IN_PROGRESS, FeedbackStatus.DONE, FeedbackStatus.REJECTED].includes(curr.status as any)) {
      throw new BadRequestException('처리가 시작된 게시글은 수정할 수 없습니다.');
    }

    const data: any = {};
    if (args.title) data.title = args.title;
    if (args.content) data.content = args.content;

    await this.prisma.feedback.update({ where: { id }, data });
    return { ok: true, id: String(id) };
  }

  // ───────────────────────────────────────────────────────────
  // 소프트 삭제 (작성자 & 처리 시작 전, superadmin 무제한)
  // ───────────────────────────────────────────────────────────
  async softDelete(id: bigint, actor: { userId: bigint; role: string }) {
    const curr = await this.prisma.feedback.findUnique({
      where: { id },
      select: { authorId: true, status: true, deleted: true },
    });
    if (!curr) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    if (curr.deleted) return { ok: true, id: String(id) };

    if (!isSuperAdmin(actor.role)) {
      if (curr.authorId !== actor.userId) throw new BadRequestException('본인 게시글만 삭제할 수 있습니다.');
      if ([FeedbackStatus.IN_PROGRESS, FeedbackStatus.DONE].includes(curr.status as any)) {
        throw new BadRequestException('처리가 시작된 게시글은 삭제할 수 없습니다.');
      }
    }

    await this.prisma.feedback.update({
      where: { id },
      data: { deleted: true, deletedAt: new Date(), deletedById: actor.userId },
    });
    return { ok: true, id: String(id) };
  }

  // ───────────────────────────────────────────────────────────
  // 상태 변경 (superadmin 전용) + 전이 규칙 체크
  // ───────────────────────────────────────────────────────────
  async changeStatus(
    id: bigint,
    args: { nextStatus: FeedbackStatus; handledById: bigint },
  ) {
    const curr = await this.prisma.feedback.findUnique({
      where: { id },
      select: { status: true, deleted: true },
    });
    if (!curr) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    if (curr.deleted) throw new BadRequestException('삭제된 게시글입니다.');

    const from = curr.status as FeedbackStatus;
    const to = args.nextStatus;

    // 허용 전이:
    // WRITTEN -> CONFIRMED/IN_PROGRESS/REJECTED
    // CONFIRMED -> IN_PROGRESS/REJECTED
    // IN_PROGRESS -> DONE
    // DONE/REJECTED -> (정지)
    const allowed = new Set<string>([
      'WRITTEN->CONFIRMED',
      'WRITTEN->IN_PROGRESS',
      'WRITTEN->REJECTED',
      'CONFIRMED->IN_PROGRESS',
      'CONFIRMED->REJECTED',
      'IN_PROGRESS->DONE',
    ]);
    const key = `${from}->${to}`;
    if (!allowed.has(key)) {
      throw new BadRequestException(`상태를 ${from}에서 ${to}(으)로 변경할 수 없습니다.`);
    }

    await this.prisma.feedback.update({
      where: { id },
      data: { status: to, handledById: args.handledById },
    });
    return { ok: true, id: String(id), status: to };
  }

  // ───────────────────────────────────────────────────────────
  // 댓글 작성 (처리 시작 후에도 작성은 허용)
  // ───────────────────────────────────────────────────────────
  async addComment(
    feedbackId: bigint,
    args: { authorId: bigint; authorLoginId: string; content: string; actorRole: string },
  ) {
    const fb = await this.prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true, deleted: true },
    });
    if (!fb) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    if (fb.deleted) throw new BadRequestException('삭제된 게시글에는 댓글을 작성할 수 없습니다.');

    const row = await this.prisma.feedbackComment.create({
      data: {
        feedbackId,
        authorId: args.authorId,
        content: args.content,
      },
      select: { id: true },
    });
    return { ok: true, id: String(row.id) };
  }

  // ───────────────────────────────────────────────────────────
  // 댓글 수정 (본인 댓글 & 처리 시작 전, superadmin 무제한)
  // ───────────────────────────────────────────────────────────
  async updateComment(
    commentId: bigint,
    args: { content: string; actor: { userId: bigint; role: string } },
  ) {
    const c = await this.prisma.feedbackComment.findUnique({
      where: { id: commentId },
      include: { feedback: { select: { status: true } } },
    });
    if (!c) throw new NotFoundException('댓글을 찾을 수 없습니다.');
    if (c.deleted) throw new BadRequestException('삭제된 댓글입니다.');

    if (!isSuperAdmin(args.actor.role)) {
      if (c.authorId !== args.actor.userId) throw new BadRequestException('본인 댓글만 수정할 수 있습니다.');
      if ([FeedbackStatus.IN_PROGRESS, FeedbackStatus.DONE].includes(c.feedback.status as any)) {
        throw new BadRequestException('처리가 시작된 게시글의 댓글은 수정할 수 없습니다.');
      }
    }

    await this.prisma.feedbackComment.update({
      where: { id: commentId },
      data: { content: args.content },
    });
    return { ok: true, id: String(commentId) };
  }

  // ───────────────────────────────────────────────────────────
  // 댓글 소프트 삭제 (본인 댓글 & 처리 시작 전, superadmin 무제한)
  // ───────────────────────────────────────────────────────────
  async softDeleteComment(
    commentId: bigint,
    actor: { userId: bigint; role: string },
  ) {
    const c = await this.prisma.feedbackComment.findUnique({
      where: { id: commentId },
      include: { feedback: { select: { status: true } } },
    });
    if (!c) throw new NotFoundException('댓글을 찾을 수 없습니다.');
    if (c.deleted) return { ok: true, id: String(commentId) };

    if (!isSuperAdmin(actor.role)) {
      if (c.authorId !== actor.userId) throw new BadRequestException('본인 댓글만 삭제할 수 있습니다.');
      if ([FeedbackStatus.IN_PROGRESS, FeedbackStatus.DONE].includes(c.feedback.status as any)) {
        throw new BadRequestException('처리가 시작된 게시글의 댓글은 삭제할 수 없습니다.');
      }
    }

    await this.prisma.feedbackComment.update({
      where: { id: commentId },
      data: { deleted: true, deletedAt: new Date(), deletedById: actor.userId },
    });
    return { ok: true, id: String(commentId) };
  }
}