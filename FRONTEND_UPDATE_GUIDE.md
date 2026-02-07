# 프론트엔드 업데이트 가이드 - 분배 기능 개선

## 📋 요약
- **변경 사항**: `PledgeRaidParticipant` 테이블 단순화 + `PledgeRaidDistributeStatus` 테이블 추가
- **영향**: 완료 분배(`complete-distribution`), 참여자 분배 업데이트(`update-participant-distribution`) 엔드포인트
- **효과**: 아이템별 분배 추적 가능, 더 세밀한 분배 관리

---

## 🔄 API 엔드포인트 변경사항

### 1️⃣ POST `/v1/pledge-raid/complete-distribution`
**목적**: 특정 드롭 아이템에 대한 분배 완료 처리

**요청 바디:**
```json
{
  "year": 2026,
  "month": 2,
  "week": 1,
  "clanId": 1,
  "bossMetaId": 5,
  "itemId": 123,
  "userId": 10,
  "distributionAmount": 50000
}
```

**변경사항 없음** ✓
- 요청 파라미터 동일
- 하지만 **백엔드에서 처리 방식 변경**:
  - 이전: `PledgeRaidParticipant` 테이블의 `isDistributed` 필드 업데이트
  - 현재: `PledgeRaidDistributeStatus` 테이블에 새 레코드 INSERT

**응답:**
```json
{
  "ok": true,
  "data": {
    "year": 2026,
    "month": 2,
    "week": 1,
    "clanId": 1,
    "bossMetaId": 5,
    "userId": 10,
    "dropItemId": 123,
    "distAmount": 50000,
    "distYn": "Y"
  }
}
```

---

### 2️⃣ POST `/v1/pledge-raid/update-participant-distribution`
**목적**: 참여자의 분배 상태 업데이트

**요청 바디:**
```json
{
  "year": 2026,
  "month": 2,
  "week": 1,
  "clanId": 1,
  "bossMetaId": 5,
  "userId": 10,
  "distributionAmount": 75000
}
```

**주의**: `itemId` 필드 제거됨 ⚠️
- 이전: `itemId` 필수
- 현재: `itemId` 제거 (특정 아이템이 아닌 참여자 전체 분배 처리)

**응답:**
```json
{
  "ok": true,
  "data": {
    "message": "Participant distribution updated successfully",
    "updatedCount": 1,
    "userId": 10
  }
}
```

---

## 📊 데이터베이스 스키마 변경

### `PledgeRaidParticipant` 테이블
```sql
-- 제거된 필드 (더 이상 사용 안 함)
- distributionAmount INT
- isDistributed VARCHAR(1)

-- 남은 필드 (참여자 추적만)
- year (PK)
- month (PK)
- week (PK)
- clanId (PK)
- bossMetaId (PK)
- userId (PK)
```

### `PledgeRaidDistributeStatus` 테이블 (NEW)
```sql
CREATE TABLE PledgeRaidDistributeStatus (
  year INT NOT NULL,
  month INT NOT NULL,
  week INT NOT NULL,
  clanId INT NOT NULL,
  bossMetaId INT NOT NULL,
  userId INT NOT NULL,
  dropItemId BIGINT NOT NULL,
  distAmount BIGINT NULL,
  distYn CHAR(1) NULL,
  
  PRIMARY KEY (year, month, week, clanId, bossMetaId, userId, dropItemId)
);
```

**필드 설명:**
- `distAmount`: 분배 금액
- `distYn`: 분배 여부 ('Y' 또는 'N', NULL 가능)

---

## 🔧 프론트엔드 구현 체크리스트

### ✅ 수정 필요 사항

#### 1. 완료 분배 버튼/로직
```javascript
// ❌ 이전 (아마도 아래처럼 했을 것)
async function completeDistribution() {
  const response = await fetch('/v1/pledge-raid/complete-distribution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year: selectedYear,
      month: selectedMonth,
      week: selectedWeek,
      clanId: clanId,
      bossMetaId: bossMetaId,
      itemId: selectedItemId,      // ✓ 유지
      userId: selectedUserId,        // ✓ 유지
      distributionAmount: amount    // ✓ 유지
    })
  });
}

// ✅ 현재 (동일하게 유지 가능)
// 요청 바디는 변경 없음
// 하지만 응답 포맷 확인 필요
```

#### 2. 참여자 분배 업데이트 로직
```javascript
// ❌ 이전
async function updateParticipantDistribution() {
  const response = await fetch('/v1/pledge-raid/update-participant-distribution', {
    method: 'POST',
    body: JSON.stringify({
      year, month, week, clanId, bossMetaId,
      userId,
      itemId: selectedItemId,        // ⚠️ 제거됨!
      distributionAmount
    })
  });
}

// ✅ 현재 (itemId 제거)
async function updateParticipantDistribution() {
  const response = await fetch('/v1/pledge-raid/update-participant-distribution', {
    method: 'POST',
    body: JSON.stringify({
      year, month, week, clanId, bossMetaId,
      userId,
      // itemId 제거!
      distributionAmount
    })
  });
}
```

#### 3. UI 표시 변경
- **이전**: "아이템별 분배 상태" → 참여자 테이블에서 표시
- **현재**: "전체 분배 금액" → `PledgeRaidDistributeStatus` 테이블에서 별도 조회 필요

---

## 🎯 분배 프로세스 플로우

### 시나리오: 아이템 분배 처리

```
1. 드롭 아이템 목록 조회 (기존 /items/list)
   └─ 아이템별 분배 상태 표시

2. 특정 아이템을 특정 사용자에게 분배
   └─ POST /complete-distribution
   └─ PledgeRaidDistributeStatus에 레코드 INSERT
   
3. 참여자 전체 분배 금액 업데이트
   └─ POST /update-participant-distribution
   └─ (선택사항) 해당 사용자의 모든 분배 기록 요약

4. 분배 현황 조회 (새로운 기능 추천)
   └─ GET /v1/pledge-raid/distribution-status?year=2026&month=2&week=1&clanId=1
   └─ 모든 사용자의 분배 현황 조회 (프론트 구현 시 필요)
```

---

## 💾 마이그레이션 영향

### 기존 데이터
- `PledgeRaidParticipant`의 `distributionAmount`, `isDistributed` 필드는 삭제됨
- 기존 분배 기록은 `PledgeRaidDistributeStatus` 테이블의 새 레코드로 이전되어야 함 (관리자 작업)

### 새로운 분배 기록
- 모든 새로운 분배는 `PledgeRaidDistributeStatus` 테이블에만 저장됨

---

## 📌 주의사항

### ⚠️ update-participant-distribution 엔드포인트 주의
- `itemId` 제거됨
- **아이템별** 분배가 아닌 **참여자별** 전체 분배 처리
- 여러 아이템 분배 시 각각 `complete-distribution` 호출 필요

### ✅ 권장 사항
1. 분배 UI는 **아이템 단위**로 구성
2. 각 아이템마다 `complete-distribution` 호출
3. 최종 요약은 `update-participant-distribution`로 처리 (선택사항)

---

## 🧪 테스트 요청 예시

### complete-distribution 테스트
```bash
curl -X POST http://localhost:3000/v1/pledge-raid/complete-distribution \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "year": 2026,
    "month": 2,
    "week": 1,
    "clanId": 1,
    "bossMetaId": 5,
    "itemId": 123,
    "userId": 10,
    "distributionAmount": 50000
  }'
```

### update-participant-distribution 테스트
```bash
curl -X POST http://localhost:3000/v1/pledge-raid/update-participant-distribution \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "year": 2026,
    "month": 2,
    "week": 1,
    "clanId": 1,
    "bossMetaId": 5,
    "userId": 10,
    "distributionAmount": 75000
  }'
```

---

## 📞 질문 사항

**Q: 이전에 이미 분배된 데이터는 어떻게 하나?**
- A: 데이터 마이그레이션 스크립트 필요 (별도 작업)

**Q: 같은 아이템을 여러 사용자에게 분배할 수 있나?**
- A: 아니오. 각 아이템은 `dropItemId`로 고유함. 아이템 분할 필요 시 레이드 결과 수정 필요

**Q: 분배 현황을 한 번에 조회할 수 있나?**
- A: `/v1/pledge-raid/userList?searchGbn=2` 엔드포인트로 조회 가능
