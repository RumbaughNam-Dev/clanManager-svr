import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class BossMetaService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.bossMeta.findMany({
      select: { id: true, name: true, location: true, respawn: true, isRandom: true },
      orderBy: [{ name: 'asc' }],
    });

    return {
      ok: true,
      bosses: rows.map(r => ({
        id: String(r.id),
        name: r.name,
        location: r.location,
        respawn: r.respawn,      // 숫자(시간)
        isRandom: r.isRandom,    // boolean
      })),
    };
  }
}