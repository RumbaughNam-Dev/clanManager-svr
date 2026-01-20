import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { PledgeRaidService } from './pledgeRaid.service';
import { SaveRaidItemsDto } from './dto/save-raid-items.dto';
import { QueryRaidItemsDto } from './dto/query-raid-items.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('/v1/pledge-raid')
export class PledgeRaidController {
  constructor(private readonly service: PledgeRaidService) {}

  /** 1) 보스 메타 정보 조회 */
  @Post('/boss-metas')
  async getBossMetas() {
    const bossMetas = await this.service.getBossMetas();
    return { bossMetas };
  }

  /** 2) 특정 주차의 컷된 보스 목록 조회 */
  @Post('/results')
  async getRaidResults(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('week') week: string,
    @Query('clanId') clanId: string,
  ) {
    if (!year || !month || !week || !clanId) {
      throw new BadRequestException('year, month, week, clanId is required');
    }

    const results = await this.service.getRaidResults({
      year: Number(year),
      month: Number(month),
      week: Number(week),
      clanId: Number(clanId),
    });

    return { results };
  }

  /** 3) 컷 처리 */
  @Post('/cut')
  async cutBoss(
    @Body()
    body: {
      year: number;
      month: number;
      week: number;
      clanId: number;
      bossMetaId: number;
      distributionMode?: "ITEM" | "TREASURY";
    },
    @Req() req: any,
  ) {
    const { year, month, week, clanId, bossMetaId } = body;

    if (!year || !month || !week || !clanId || !bossMetaId) {
      throw new BadRequestException('invalid request body');
    }

    const actorLoginId: string =
      req.user?.loginId ??
      req.user?.username ??
      (req.user?.id != null ? String(req.user.id) : 'system');

    const ok = await this.service.cutBoss(body, actorLoginId);
    return { ok: true };
  }

  /** 4) 드랍 아이템 목록 조회 (POST) */
  @Post('/items/list')
  async listRaidItems(@Body() body: QueryRaidItemsDto) {
    const { year, month, week, clanId, bossMetaId } = body;

    if (!year || !month || !week || !clanId || !bossMetaId) {
      throw new BadRequestException(
        'year, month, week, clanId, bossMetaId is required',
      );
    }

    const result = await this.service.listRaidItems({
      year,
      month,
      week,
      clanId,
      bossMetaId,
    });

    // service에서 { ok, items } 형태로 리턴한다고 가정
    return result;
  }

  /** 5) 드랍 아이템 저장 (POST) */
  @Post('/items/save')
  async saveRaidItems(
    @Req() req: any,
    @Body() body: SaveRaidItemsDto,
  ) {
    const { year, month, week, clanId, bossMetaId, items } = body;

    if (!year || !month || !week || !clanId || !bossMetaId) {
      throw new BadRequestException(
        'year, month, week, clanId, bossMetaId is required',
      );
    }

    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('items must be array');
    }

    // JWT에서 로그인 아이디 꺼내기 (없으면 fallback)
    const actorLoginId: string =
      req.user?.loginId ??
      req.user?.username ??
      (req.user?.id != null ? String(req.user.id) : 'system'); // ✅ 여기서 아이디 추출

    return this.service.saveRaidItems(body, actorLoginId); // ✅ 두 번째 인자로 전달
  }
}