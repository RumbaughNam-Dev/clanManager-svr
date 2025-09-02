// 응답 DTO들 (프론트와 합의된 필드명 유지)

export type LootItemDto = {
  id: string;
  itemName: string;
  isSold: boolean;
  soldAt: string | null;
  soldPrice: number | null;
  toTreasury?: boolean;   // DB 필드명(toTreasury) 그대로
  isTreasury?: boolean;   // 프론트 호환(둘 다 내려줌)
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