# Project state

| Stage | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0: Foundation | Done, 2026-11-05 | PostgreSQL local: `./init.sh` (3 tests, typecheck), `npm run seed`, `npm start` (`/health` returned schema version 1) | Stage 1 business rules |
| 1: Finance | Pending | No engine/API/UI proof yet | 17 independent cases in spec section 11, then two-month and phone flow checks |
| 2: Goals and journal | Blocked by stage 1 and one month of real use | None | Spec section 12 |
| 3: Polish | Pending | None | Spec section 12 |

Update this table at stage gates or when evidence changes. Check current code and rerun relevant checks before relying on old results.
