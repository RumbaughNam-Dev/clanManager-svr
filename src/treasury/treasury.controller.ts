// src/treasury/treasury.controller.ts
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

@Controller('treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly svc: TreasuryService) {}

  @Post()
  async list(
    @Req() req: any,
    // 🔹 이 핸들러에서는 알 수 없는 쿼리 허용(전역 forbidNonWhitelisted 무력화)
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
    q: ListTreasuryQueryDto,
  ): Promise<ListTreasuryResp> {
    const clanId = req.user?.clanId;
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');
    return this.svc.list(clanId, q);
  }

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
      note: body.source?.trim() || undefined, // ✔ note에 출처 저장
    });

    return { ok: true, item: { id: String(created.id) } };
  }

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