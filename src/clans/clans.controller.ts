import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClansService } from './clans.service';

@Controller('clans')
@UseGuards(JwtAuthGuard)
export class ClansController {
  constructor(private readonly clansService: ClansService) {}

  @Get(':clanId/discord-link')
  getDiscordLink(@Param('clanId') clanId: string, @Req() req: any) {
    return this.clansService.getDiscordLink(clanId, req.user ?? {});
  }

  @Put(':clanId/discord-link')
  updateDiscordLink(
    @Param('clanId') clanId: string,
    @Req() req: any,
    @Body() body: { discordLink?: string | null },
  ) {
    return this.clansService.updateDiscordLink(
      clanId,
      req.user ?? {},
      body?.discordLink,
    );
  }

  @Get(':clanId/hostiles')
  listHostiles(@Param('clanId') clanId: string, @Req() req: any) {
    return this.clansService.listHostiles(clanId, req.user ?? {});
  }

  @Post(':clanId/hostiles')
  createHostile(
    @Param('clanId') clanId: string,
    @Req() req: any,
    @Body()
    body: {
      userId?: string | number;
      hostileClanName?: string | null;
      reason?: string | null;
      hostileAt?: string | null;
    },
  ) {
    return this.clansService.createHostile(clanId, req.user ?? {}, body ?? {});
  }

  @Delete(':clanId/hostiles/:seq')
  deleteHostile(
    @Param('clanId') clanId: string,
    @Param('seq') seq: string,
    @Req() req: any,
  ) {
    return this.clansService.deleteHostile(clanId, seq, req.user ?? {});
  }
}
