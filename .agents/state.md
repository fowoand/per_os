# Project state

| Stage | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0: Foundation | Done, 2026-11-05 | PostgreSQL local: `./init.sh` (3 tests, typecheck), `npm run seed`, `npm start` (`/health` returned schema version 1) | Stage 1 business rules |
| 1: Finance | Pending | No engine/API/UI proof yet | 17 independent cases in spec section 11, then two-month and phone flow checks |
| 2: Goals and journal | Blocked by stage 1 and one month of real use | None | Spec section 12 |
| 3: Polish | Pending | None | Spec section 12 |

Update this table at stage gates or when evidence changes. Check current code and rerun relevant checks before relying on old results.

## Environment workflow

- Default development branch: `dev`, local PostgreSQL only. `main` is reviewed release source.
- `vercel.json` disables automatic Git deployments for both linked Vercel projects. A push to either branch does not release code; deploy only on request through `./deploy.sh dev|prod`.
- Preview uses `personal-os-dev-db`; Production uses `personal-os-prod-db`. Both Vercel deployments have protection enabled. See `doc/development_workflow.md` for the gate and aliases.
- The current BE serves `/health` and the FE is a placeholder. Stage 1 finance acceptance and Internet-facing authentication remain pending.
