// Run on the API host with the production environment loaded.
// Credentials JSON is kept outside the repository with mode 0600.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/allblue-client');

async function main() {
  const credentials = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (credentials.userId !== 'allblue_app_review' || typeof credentials.code !== 'string' || credentials.code.length < 16) throw new Error('Invalid demo credentials');
  if (!process.env.JWT_SECRET || !process.env.ALLBLUE_DATABASE_URL) throw new Error('Production auth/database configuration is required');
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { userId: credentials.userId } });
    if (existing) throw new Error('Account already exists; refusing to overwrite it');
    const password = await bcrypt.hash(randomUUID(), 12);
    const user = await prisma.user.create({ data: {
      userId: credentials.userId, password, nickname: '데모 다이버', userName: 'Demo Reviewer',
      userType: 'instructor', status: 'approved',
      profile: { create: { level: '5', description: '앱 기능 검토를 위한 공용 데모 계정입니다. 개인정보를 입력하지 마세요.' } },
    } });
    // This file contains only a password hash, not the review access code.
    const hash = await bcrypt.hash(credentials.code, 12);
    fs.writeFileSync(process.argv[3], `\nALLBLUE_DEMO_USER_ID=${credentials.userId}\nALLBLUE_DEMO_CODE_HASH='${hash}'\n`, { mode: 0o600 });
    console.log(JSON.stringify({ created: true, id: user.id, userId: user.userId }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
