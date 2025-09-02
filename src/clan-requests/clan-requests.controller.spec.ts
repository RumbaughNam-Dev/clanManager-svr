import { Test, TestingModule } from '@nestjs/testing';
import { ClanRequestsController } from './clan-requests.controller';

describe('ClanRequestsController', () => {
  let controller: ClanRequestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClanRequestsController],
    }).compile();

    controller = module.get<ClanRequestsController>(ClanRequestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
