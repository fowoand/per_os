# Development and release contract

This document fixes environment boundaries. `doc/spec_init_001.md` remains the source for features, formulas, and stage gates.

| Environment | Branch / command | Database | Release |
| --- | --- | --- | --- |
| Local | `dev`, `./dev.sh` | Docker Compose PostgreSQL volume; separate test database | None |
| Preview | `dev`, `./deploy.sh dev` | Neon `personal-os-dev-db` | Manual after tests; aliases `personal-os-api-dev.vercel.app`, `personal-os-web-dev.vercel.app` |
| Production | `main`, `./deploy.sh prod` | Neon `personal-os-prod-db` | Manual after Preview gate; aliases `personal-os-api-ruby.vercel.app`, `personal-os-web-fawn.vercel.app` |

## Invariants

- Vercel projects `personal-os-api` and `personal-os-web` belong to team `huangans-projects` and connect to GitHub repo `fowoand/per_os`. Root Directory settings are `apps/server` and `apps/web`; CLI uploads the repository root so the server build can resolve `packages/core`.
- `vercel.json` disables automatic Git deployment. Pushing `dev` or `main` updates Git only. A code, test, commit, or push request does not authorize `deploy.sh`.
- Local uses local PostgreSQL, Preview uses Neon dev, and Production uses Neon prod. Never share `DATABASE_URL` between environments, copy production data into dev, or seed Vercel. Secrets stay server-side, outside Git and `VITE_`.
- `packages/core` owns pure logic; `apps/server` owns HTTP, persistence, migrations, and transactions; `apps/web` calls the API. Never persist calculated balances. Money uses integer VND; unknown debt balance remains `NULL`.
- Vercel Deployment Protection is enabled. Financial APIs need authentication and access control before Internet exposure. Back up and test restore before real use, per spec section 9.
- Local Compose services use `restart: unless-stopped`; opening Docker Desktop restarts DB, API, and FE after the first `./dev.sh` bootstrap. Seed remains manual so restarts never rewrite user data.
- Local PostgreSQL backup runs at 03:00 via `~/Library/LaunchAgents/com.personal-os.backup.plist`. `scripts/backup-postgres.sh` writes a custom-format `pg_dump` outside the repo and restores it into a temporary database before keeping the archive. Docker Desktop must be running. Preview Neon backup policy is a separate release check.

## Gates

1. Develop on `dev` against local PostgreSQL. Inspect current source and `.agents/state.md`; follow spec sections 11-12. Run `./init.sh` after code changes. Build FE when needed or before deployment.
2. After local checks and a commit, deploy Preview only on request with `./deploy.sh dev`. Script reruns test/typecheck/build, verifies BE/FE, then updates dev aliases. Browser and phone flows need separate evidence.
3. Move reviewed commits to `main` only after Preview passes its gate. For an authorized release, check production backup/restore and migration safety, then run `./deploy.sh prod`. Script stages deployments without alias changes, verifies BE/FE, then promotes them.
4. Update `.agents/state.md` when a stage gate changes. Report passed checks and missing evidence separately. A push is not a deployment.
