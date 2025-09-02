// prisma/seed-bossmeta.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type RawRow = {
  name: string;
  respawn: string;   // 예: "2시간", "3시간/R", "3.5시간/R"
  location: string;
  tpSave?: string;
  difficulty?: string;
  notes?: string;
  orderNo: number;
  active?: boolean;
};

// 원본 데이터
const rawRows: RawRow[] = [
  { name: "서드", respawn: "2시간",     location: "50.용계 서쪽 입구 언덕 랜덤젠", tpSave: "가능(불필요)", difficulty: "하", orderNo: 10 },
  { name: "북드", respawn: "2시간",     location: "50.용계 서쪽 입구 폭젠 랜덤젠", tpSave: "가능(불필요)", difficulty: "하", orderNo: 20 },
  { name: "녹샤", respawn: "2시간/R",   location: "39.엘모어 전초기지", tpSave: "가능(불필요)", difficulty: "하", orderNo: 30 },
  { name: "케레", respawn: "3시간/R",   location: "77.흑기사 전투기지, 폭젠3구역 랜덤젠", tpSave: "불가", difficulty: "상", orderNo: 40 },
  { name: "마요", respawn: "3시간/R",   location: "29.설원 6구역 동굴", tpSave: "가능(필수)", difficulty: "상", orderNo: 50 },
  { name: "가마", respawn: "3.5시간/R", location: "1.개미굴 던전 4층", tpSave: "불가", difficulty: "상(써치)", orderNo: 60 },
  { name: "네크로스", respawn: "4시간/R", location: "23.버려진 고목나무 폭젠", tpSave: "가능(불필요)", difficulty: "상", orderNo: 70 },
  { name: "베리스", respawn: "6시간/R", location: "77.흑기사 전투기지(유령마수 등장처 보스젠)", tpSave: "불가", difficulty: "상", notes: "선착장에서 암흑대검 먼저 처치 후 / 흑기사전투기지 6시 폭젠에 등장", orderNo: 80 },
  { name: "오르크스", respawn: "6시간/R", location: "43.오크숲 벌목지대 폭젠", tpSave: "가능(불필요)", difficulty: "상", orderNo: 90 },
  { name: "거드", respawn: "6시간/R",   location: "50.용계 서쪽 입구_정상", tpSave: "가능(불필요)", difficulty: "상", orderNo: 100 },
  { name: "감시자 데몬", respawn: "6시간/R", location: "상아탑 7층_광역전", tpSave: "불가", difficulty: "최하", orderNo: 110 },
  { name: "도펠", respawn: "7시간/R",   location: "2.거울의 숲 오른쪽 게밭촌", tpSave: "가능(필수)", difficulty: "하", orderNo: 120 },
  { name: "가스트", respawn: "7.5시간/R", location: "42.오크숲 벌목지대", tpSave: "가능(필수)", difficulty: "하", orderNo: 130 },
  { name: "리칸드", respawn: "7.5시간/R", location: "74.하늘의 섬_광역전", tpSave: "가능(필수)", difficulty: "중", orderNo: 140 },
  { name: "차즈", respawn: "8시간/R",   location: "76.황혼산맥", tpSave: "불가", difficulty: "상", orderNo: 150 },
  { name: "데스", respawn: "9시간/R",   location: "18.망자의 무덤_광역전", tpSave: "가능(불필요)", difficulty: "상", orderNo: 160 },
  { name: "겔무트", respawn: "10시간/R", location: "2.말하는섬_거울 기사단입선착장", tpSave: "가능(불필요)", difficulty: "상", orderNo: 170 },
  // … 추가 가능
];

// "3시간/R" → { respawn: 180, isRandom: true }  (분 단위)
function normalizeRespawn(raw: string): { respawn: number; isRandom: boolean } {
  const s = String(raw ?? '').trim();
  const isRandom = /\/R$/i.test(s);
  const base = s.replace(/\/R$/i, '').trim();             // "3시간/R" -> "3시간"

  // "3시간", "3.5시간" 허용
  const m = base.match(/([\d.]+)\s*시간/i);
  const hours = m ? parseFloat(m[1]) : 0;
  const minutes = Math.round(hours * 60);

  return { respawn: minutes, isRandom };
}

async function main() {
  for (const r of rawRows) {
    const { respawn, isRandom } = normalizeRespawn(r.respawn);

    await prisma.bossMeta.upsert({
      where: { name: r.name },
      update: {
        // 절대 ...r 하지 말 것 (r.respawn이 string)
        location: r.location ?? '',
        tpSave: r.tpSave ?? null,
        difficulty: r.difficulty ?? null,
        notes: r.notes ?? null,
        orderNo: Number.isFinite(r.orderNo) ? r.orderNo : 0,
        active: r.active ?? true,

        respawn,      // number(분)
        isRandom,     // boolean
      },
      create: {
        name: r.name,
        location: r.location ?? '',
        tpSave: r.tpSave ?? null,
        difficulty: r.difficulty ?? null,
        notes: r.notes ?? null,
        orderNo: Number.isFinite(r.orderNo) ? r.orderNo : 0,
        active: r.active ?? true,

        respawn,      // number(분)
        isRandom,     // boolean
      },
    });
  }

  console.log(`Seeded ${rawRows.length} bosses.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });