export interface TimelineItemDto {
  id: string;
  bossName: string;
  cutAt: string;
  createdBy: string;
  imageIds: string[];
  noGenCount: number;            // 🔵 추가
  items: Array<{
    id: string;
    itemName: string;
    isSold: boolean;
    soldAt: string | null;
    soldPrice: number | null;
    toTreasury: boolean;
    isTreasury: boolean;
    looterLoginId: string | null;
  }>;
  distributions: Array<{
    lootItemId: string | null;
    recipientLoginId: string;
    isPaid: boolean;
    paidAt: string | null;
  }>;
}

export interface TimelineDto extends TimelineItemDto {}
export interface ListTimelinesResp {
  ok: true;
  items: TimelineDto[];
}
