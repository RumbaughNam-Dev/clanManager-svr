import { Controller, Post } from '@nestjs/common';
import { BossMetaService } from './bossmeta.service';

@Controller('bossmeta')
export class BossMetaController {
  constructor(private readonly service: BossMetaService) {}

  @Post()
  list() {
    return this.service.list();
  }
}