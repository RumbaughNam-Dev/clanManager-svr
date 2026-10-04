# AllBlue review account access

`POST /allblue/auth/demo` accepts `{ "code": "..." }` and returns the same session/user shape used by mobile social login. The server chooses the account; the caller cannot supply an account ID or role. Credentials are checked against a bcrypt hash. The endpoint limits attempts by request IP; behind the current proxy this intentionally shares a limit unless trusted proxy handling is configured separately.

Required runtime settings: `ALLBLUE_DEMO_USER_ID`, `ALLBLUE_DEMO_CODE_HASH`, and the existing `JWT_SECRET`. Missing settings fail closed. Tokens expire after 24 hours and include `demo: true`.

Use a dedicated account without linked social identities or real personal data. Production currently stores userType as enum('instructor','admin'), so provisioning uses `instructor`, never `admin`; profile level 5 permits inspecting ordinary instructor features. Do not change the production schema for this feature. The provisioning script refuses to overwrite an existing account and generates a random inaccessible account password.

The review code must be stored outside the repository and supplied only through App Store Connect review credentials/notes. `scripts/provision-demo-account.cjs` takes a protected credentials JSON path and an output env-fragment path. Load the intended environment before running. Never print or commit the credentials or environment files.

After a valid code, a missing account is created with a fresh numeric ID; concurrent creation reuses the winner. Account deletion removes schedules, logs, friends, notifications and push registrations transactionally. Old demo sessions are rejected by numeric ID even after recreation. Push registration works normally. Profile privilege escalation remains blocked. Other existing app behavior remains the same; this is a shared account, not an isolated simulated backend. Tell reviewers not to enter personal data. There is no automatic expiry of the entry point or review code. Rotate the code only with updated review instructions and account for already-issued sessions.
