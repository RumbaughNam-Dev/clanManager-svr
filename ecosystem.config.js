module.exports = {
	apps: [
		{
			name: "clan-api",
			script: "dist/src/main.js", // 너가 빌드 산출물로 띄운다면
			// script: "npm", args: "run start:prod"  // 이런 식으로 띄우는 경우엔 이걸로 바꿔야 함
			env_production: {
				DATABASE_URL: "mysql://expoool:QkdnFJA2093!@clanmanager.c36scau0s738.ap-northeast-2.rds.amazonaws.com/clan_manager?connection_limit=12",
				NODE_ENV: "production",
			},
		},
	],
};
