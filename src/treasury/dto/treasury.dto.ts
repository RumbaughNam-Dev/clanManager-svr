// DTO & 타입들

export type TreasuryEntryType =
  | 'SALE_TREASURY'
  | 'MANUAL_IN'
  | 'MANUAL_OUT'
  | 'PLEDGE_RAID'
  | 'PLEDGE_RAID_CANCEL';

export class ListTreasuryQueryDto {
  /** 1부터 시작 */
  page?: number;
  /** 1~100 */
  size?: number;
  /** ALL | SALE_TREASURY | MANUAL_IN | MANUAL_OUT */
  type?: 'ALL' | TreasuryEntryType;
}

export type TreasuryRowDto = {
  id: string;
  createdAt: string; // ISO
  entryType: TreasuryEntryType;
  amount: number;
  balance: number;
  note: string | null;
  createdBy: string;
  timelineId: string | null;
  lootItemId: string | null;
};

export type ListTreasuryResp = {
  ok: true;
  page: number;
  size: number;
  total: number;
  pages: number;
  balance: number;
  items: TreasuryRowDto[];
};