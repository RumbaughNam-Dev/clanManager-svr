import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TreasuryService } from './treasury.service';
import { ListTreasuryQueryDto, ListTreasuryResp } from './dto/list-treasury.dto';
import { CreateManualInDto } from './dto/create-manual-in.dto';
import { CreateManualOutDto } from './dto/create-manual-out.dto';

@Controller('v1/treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly svc: TreasuryService) {}

  /**
   * 혈비 원장 조회(모든 혈맹원 가능)
   * GET /v1/treasury?page=1&size=20&type=IN|OUT  (type은 선택)
   */
  @Post()
  async list(@Req() req: any, @Query() q: ListTreasuryQueryDto): Promise<ListTreasuryResp> {
    const clanId = req.user?.clanId;
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');
    return this.svc.list(clanId, q);
  }

  /**
   * 혈비 수동 유입 (ADMIN/LEADER/SUPERADMIN)
   * Post, /v1/treasury/manual-in { amount:number, source:string }
   */
  @Post('manual-in')
  async manualIn(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) body: CreateManualInDto,
  ) {
    const role = req.user?.role ?? 'USER';
    if (!['ADMIN', 'LEADER', 'SUPERADMIN'].includes(role)) {
      throw new ForbiddenException('권한이 없습니다.');
    }
    const clanId = req.user?.clanId ?? null;
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');

    const created = await this.svc.manualIn({
      clanId,
      actor: req.user?.loginId ?? 'system',
      amount: body.amount,
      // ⚠️ note 필드에 출처 저장
      note: body.source?.trim() || undefined,
    });

    return { ok: true, item: { id: String(created.id) } };
  }

  /**
   * 혈비 수동 사용(출금) (ADMIN/LEADER/SUPERADMIN)
   * Post, /v1/treasury/manual-out { amount:number, note:string }
   */
  @Post('manual-out')
  async manualOut(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) body: CreateManualOutDto,
  ) {
    const role = req.user?.role ?? 'USER';
    if (!['ADMIN', 'LEADER', 'SUPERADMIN'].includes(role)) {
      throw new ForbiddenException('권한이 없습니다.');
    }
    const clanId = req.user?.clanId ?? null;
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');

    const created = await this.svc.manualOut({
      clanId,
      actor: req.user?.loginId ?? 'system',
      amount: body.amount,
      note: body.note?.trim() || undefined,
    });

    return { ok: true, item: { id: String(created.id) } };
  }
}