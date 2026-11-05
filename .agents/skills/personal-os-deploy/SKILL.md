---
name: personal-os-deploy
description: Prepare and execute manual Vercel deployment for this repo's Fastify backend and React/Vite frontend. Use for Personal OS BE/FE deploy planning, setup, verification, or release; not for ordinary local development.
---

# Personal OS deploy

Read `AGENTS.md`, `doc/development_workflow.md`, `.agents/state.md`, and sections 2, 9, 10, 11, 12 of `doc/spec_init_001.md`. Use `../vercel-cli/SKILL.md` for CLI details; use `../deploy-to-vercel/SKILL.md` when a deployment is requested. Confirm command syntax with installed `vercel --help`.

Current repo has `apps/server` with Fastify `/health` and `apps/web` with a Vite placeholder. Stage 1 finance API/UI and authentication are pending. Treat current files and stage evidence as authoritative.

## Deployment boundary

- A code, test, commit, or push request does not authorize deployment. `vercel.json` disables Git auto deploy. Only run `./deploy.sh dev` or `./deploy.sh prod` for an explicit deployment request; this script reruns checks and verifies targets before changing aliases.
- `dev` uses local PostgreSQL, Preview uses `personal-os-dev-db`, and Production uses `personal-os-prod-db`. Keep credentials in server environments, never in Git or `VITE_`. Do not seed on Vercel.
- Both projects are linked to `fowoand/per_os` in team `huangans-projects`; Root Directory is empty so `deploy.sh` can deploy from each app directory. Check the resolved project before mutations. A future root change requires updating and testing the script first.
- Review migration safety, backup/restore, and access control before releasing financial data. Authentication plus Stage 1's 17 cases, two-month flow, and phone flow remain required; a protected placeholder is not release proof.

## When deployment is requested

- Check current branch, diff, stage gate, app entrypoints, project links, database assignments, and access policy. Do not equate a Git push or a `Ready` build with a working release.
- Preview: after local tests and a committed `dev` source, run `./deploy.sh dev`; verify BE and FE, then inspect browser/phone flows when in scope. Production: promote reviewed source to `main`, verify backup and migrations, then run `./deploy.sh prod`. It stages builds without aliases and promotes only after BE/FE checks.
- Report exact deployment URLs and environment, passed checks, untested behavior, and rollback path. Update `.agents/state.md` only when a stage gate changes. Do not commit or push unless requested.

Vercel sources: https://vercel.com/docs/cli/deploying-from-cli ; https://vercel.com/docs/agent-resources/skills ; https://vercel.com/kb/guide/ship-a-fastify-app-on-vercel
