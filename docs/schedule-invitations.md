# Schedule invitations and notification inbox

Development and production backends share one AllBlue database. Apply the SQL provided in the task conversation once to that shared database before deploying either backend. It adds invitation columns with `accepted` as the default for existing participants and creates `app_notification`. Existing participants receive no migration notifications. SQL is supplied in the conversation rather than stored in this repository; do not run a general reset against the shared database.

Then regenerate `@prisma/allblue-client`, build/deploy the backends, and release the updated AllBlue app. Until the app update, old clients cannot respond to new invitations. No database changes were performed by the implementation agent; confirm whether the shared schema changes have already been applied before running them.

## Rules

- Newly added account holders start as `pending`; the creator and legacy guests remain accepted.
- Invitation status/token are preserved when the creator edits an existing participant. Concurrent responses cannot be overwritten by those edits.
- Responses use the current invitation token. Resending a rejected invitation rotates it and creates a new unread notification.
- Removing a rejected request hides the participant; notification history remains independent of participant/schedule deletion.
- Notifications require sender and receiver IDs, are scoped to the receiver, and can only be hidden after reading. Hiding sets `deleted_at`; it does not delete a row.
- Notification creation occurs in the schedule transaction. Push delivery uses the shared push service after commit; missing tokens or push errors do not discard the inbox record.
- `GET /allblue/notifications` returns ten records, a continuation flag, and the unread count. `before`/`after` use ID cursors; `ceiling` fixes the browsing snapshot. The client retains at most 50 records and evicts ten at a time.
- Rejected/removed participants are excluded from the receiver's own calendar. Existing social access is checked independently: mutual close friends, a past accepted lesson with an instructor whose schedule is public, or a public schedule created by a member of the viewer's group.
- Teaching schedule/participant categories (experience, certification, lecture) require instructor/admin access on the server. Button visibility uses the individual participation category.

## Verification

Backend: `npm test -- --runInBand schedule-invitations schedule-document-reuse schedule-access` and `npx nest build`.
App: `npm test` and `npm run typecheck`.

Device acceptance checks after deployment: register another account; receive/tap a push with the app closed and open; accept/reject; resend then try an old token; check unread/all/hidden notifications; browse more than 50 notifications in both directions; confirm the existing participants are unchanged.
