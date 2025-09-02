import { Controller, Get } from '@nestjs/common';
import { BossMetaService } from './bossmeta.service';

@Controller('v1/bossmeta')
export class BossMetaController {
  constructor(private readonly service: BossMetaService) {}

  @All()
  list() {
    return this.service.list();
  }
}