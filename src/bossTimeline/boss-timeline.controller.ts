// src/bossTimeline/boss-timeline.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Param,
  UseGuards,
  Req,
  Post, // ← Patch 제거하고 Post만
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BossTimelineService } from './boss-timeline.service';
import { ListTimelinesResp } from './dto/timeline.dto';
import { UpdateDistributionPaidDto } from './dto/update-distribution-paid.dto';

@Controller('v1/boss-timelines')
@UseGuards(JwtAuthGuard)
export class BossTimelineController {
  constructor(private readonly svc: BossTimelineService) {}

  /** 잡은 보스 타임라인 목록 */
  @Post()
  async list(@Req() req: any): Promise<ListTimelinesResp> {
    const clanId = req.user?.clanId ?? null;
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');
    return this.svc.listForClan(clanId);
  }

  /** 아이템 판매 처리 (PATCH → POST) */
  @Post(':timelineId/items/:itemId/sell')
  async markItemSold(
    @Param('timelineId') timelineId: string,
    @Param('itemId') itemId: string,
    @Body() body: { soldPrice: number },
    @Req() req: any,
  ) {
    const raw = body?.soldPrice;
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('soldPrice(숫자, 세후 정산가)가 필요합니다.');
    }
    const actorLoginId = req.user?.loginId ?? 'system';
    const clanId = req.user?.clanId;
    return this.svc.markItemSold(timelineId, itemId, price, actorLoginId, clanId);
  }

  /** 분배 지급 완료/취소 즉시 반영 (PATCH → POST) */
  @Post(':timelineId/distributions/:distId/paid')
  async markDistributionPaid(
    @Req() req: any,
    @Param('timelineId') timelineId: string,
    @Param('distId') distId: string,
    @Body() body: { isPaid: boolean },
  ) {
    if (typeof body?.isPaid !== 'boolean') {
      throw new BadRequestException('isPaid(boolean)는 필수입니다.');
    }
    return this.svc.markDistributionPaid({
      timelineId,
      distId,
      isPaid: body.isPaid,
      actorLoginId: req.user?.loginId ?? 'system',
      actorRole: req.user?.role ?? 'USER',
      clanId: req.user?.clanId,
    });
  }

  /** 단건 상세 (이미 POST로 잘 맞음) */
  @Post(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    const clanId = req.user?.clanId;
    return this.svc.getTimelineDetail(clanId, id);
  }

  /** 참여자별 분배완료 처리 (PATCH → POST) */
  @Post(':timelineId/items/:itemId/distributions/:recipientLoginId')
  async setDistributionPaid(
    @Param('timelineId') timelineId: string,
    @Param('itemId') itemId: string,
    @Param('recipientLoginId') recipientLoginId: string,
    @Body() dto: UpdateDistributionPaidDto,
    @Req() req: any,
  ) {
    const actorLoginId: string = req.user?.loginId ?? 'unknown';
    if (typeof dto?.isPaid !== 'boolean') {
      throw new BadRequestException('isPaid(boolean)는 필수입니다.');
    }
    return this.svc.setDistributionPaid({
      timelineId,
      itemId,
      recipientLoginId,
      isPaid: dto.isPaid,
      actorLoginId,
    });
  }
}