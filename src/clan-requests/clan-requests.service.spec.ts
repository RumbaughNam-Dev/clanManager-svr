import { Test, TestingModule } from '@nestjs/testing';
import { ClanRequestsService } from './clan-requests.service';

describe('ClanRequestsService', () => {
  let service: ClanRequestsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClanRequestsService],
    }).compile();

    service = module.get<ClanRequestsService>(ClanRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
