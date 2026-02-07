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
import { UserListQueryDto } from './dto/user-list.dto';
import { CompleteDistributionDto } from './dto/complete-distribution.dto';
import { AddParticipantsDto } from './dto/add-participants.dto';
import { UpdateParticipantDistributionDto } from './dto/update-participant-distribution.dto';
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

  /** 6) 혈맹원 목록 조회 (searchGbn: 1=목록만, 2=분배정보포함) */
  @Post('/userList')
  async getUserList(@Body() query: UserListQueryDto) {
    const { year, month, week, clanId, bossMetaId, searchGbn = 1 } = query;

    if (!year || !month || !week || !clanId || !bossMetaId) {
      throw new BadRequestException(
        'year, month, week, clanId, bossMetaId is required',
      );
    }

    if (![1, 2].includes(searchGbn)) {
      throw new BadRequestException('searchGbn must be 1 or 2');
    }

    const result = await this.service.getUserList({
      year,
      month,
      week,
      clanId,
      bossMetaId,
      searchGbn,
    });

    return result;
  }

  /** 7) 내 혈맹 전체 혈맹원 목록 조회 */
  @Post('/clanMembers')
  async getClanMembers(@Req() req: any) {
    const loginId: string =
      req.user?.loginId ??
      req.user?.username ??
      (req.user?.id != null ? String(req.user.id) : null);

    if (!loginId) {
      throw new BadRequestException('User not authenticated');
    }

    const result = await this.service.getClanMembers(loginId);
    return result;
  }

  /** 8) 보스 레이드 참여자 목록 조회 */
  @Post('/participants')
  async getParticipants(@Body() query: QueryRaidItemsDto) {
    const { year, month, week, clanId, bossMetaId, itemId } = query;

    if (!year || !month || !week || !clanId || !bossMetaId) {
      throw new BadRequestException(
        'year, month, week, clanId, bossMetaId is required',
      );
    }

    const result = await this.service.getParticipants({
      year,
      month,
      week,
      clanId,
      bossMetaId,
      itemId,
    });

    return result;
  }

  /** 9) 참여자 저장 (기존 데이터 삭제 후 새로 삽입) */
  @Post('/add-participants')
  async addParticipants(@Body() body: AddParticipantsDto) {
    if (!body.participants || !Array.isArray(body.participants) || body.participants.length === 0) {
      throw new BadRequestException('participants array is required');
    }

    // 모든 참여자가 동일한 year, month, week, clanId, bossMetaId를 가져야 함
    const first = body.participants[0];
    const isSameContext = body.participants.every(
      (p) =>
        p.year === first.year &&
        p.month === first.month &&
        p.week === first.week &&
        p.clanId === first.clanId &&
        p.bossMetaId === first.bossMetaId,
    );

    if (!isSameContext) {
      throw new BadRequestException(
        'All participants must have same year, month, week, clanId, bossMetaId',
      );
    }

    const result = await this.service.addParticipants(body.participants);
    return result;
  }

  /** 10) 분배 완료 처리 */
  @Post('/complete-distribution')
  async completeDistribution(@Body() body: CompleteDistributionDto) {
    const { year, month, week, clanId, bossMetaId, itemId, userId, distributionAmount } = body;

    if (!year || !month || !week || !clanId || !bossMetaId || !itemId || !userId || distributionAmount === undefined) {
      throw new BadRequestException(
        'year, month, week, clanId, bossMetaId, itemId, userId, distributionAmount is required',
      );
    }

    const result = await this.service.completeDistribution({
      year,
      month,
      week,
      clanId,
      bossMetaId,
      itemId,
      userId,
      distributionAmount,
    });

    return result;
  }

  /** 11) 참여자 분배 정보 업데이트 (사용자별 분배 완료) */
  @Post('/update-participant-distribution')
  async updateParticipantDistribution(@Body() body: UpdateParticipantDistributionDto) {
    const { year, month, week, clanId, bossMetaId, userId, distributionAmount } = body;

    if (!year || !month || !week || !clanId || !bossMetaId || !userId || distributionAmount === undefined) {
      throw new BadRequestException(
        'year, month, week, clanId, bossMetaId, userId, distributionAmount is required',
      );
    }

    const result = await this.service.updateParticipantDistribution({
      year,
      month,
      week,
      clanId,
      bossMetaId,
      userId,
      distributionAmount,
    });

    return result;
  }
}
