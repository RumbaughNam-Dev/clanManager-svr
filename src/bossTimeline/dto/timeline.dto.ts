// 응답 DTO들 (프론트 합의 필드명 유지)

export type LootItemDto = {
  id: string;
  itemName: string;
  isSold: boolean;
  soldAt: string | null;
  soldPrice: number | null;
  toTreasury?: boolean;   // DB 필드명 그대로
  isTreasury?: boolean;   // 프론트 호환
  looterLoginId: string | null; // ✅ API 필드명
};

export type DistributionDto = {
  lootItemId: string | null;
  recipientLoginId: string;
  isPaid: boolean;
  paidAt: string | null;
};

export type TimelineDto = {
  id: string;
  bossName: string;
  cutAt: string;          // ISO
  createdBy: string;
  imageIds: string[];     // 없으면 []
  items: LootItemDto[];
  distributions: DistributionDto[];
};

export type ListTimelinesResp = {
  ok: true;
  items: TimelineDto[];
};