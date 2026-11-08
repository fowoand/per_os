---
name: personal-os-coding
description: Coordinate this repo's TypeScript, backend, UI design, and deployment skills for Personal OS code changes and reviews.
---

# Personal OS coding

Read `AGENTS.md`, `doc/spec_init_001.md`, `doc/development_workflow.md`, and `.agents/state.md` before work. Follow the current stage and its test gate. Those files and the user's request override generic examples in installed skills. Develop on `dev` against local PostgreSQL; a Git push does not deploy.

## Required skill routing

- Every TypeScript change or review: read `../typescript-patterns/SKILL.md` (ECC).
- `packages/core` or `apps/server`: also read `../backend-patterns/SKILL.md` (ECC). Keep core pure, money as integer VND, and PostgreSQL transactions for multi-table writes. Do not add layers, caching, or services merely because the skill shows them.
- `apps/web` or other UI work: first read `../personal-os-ui/SKILL.md` and `DESIGN.md`, then `../frontend-patterns/SKILL.md` (ECC), `../react-best-practices/SKILL.md` (Vercel), and `../impeccable/SKILL.md`. Use the Radiant tokens and shared components for visual direction; use Impeccable for rendered review. Run `python3 scripts/check-ui-style.py` after UI edits. Before calling UI finished, read `../web-design-guidelines/SKILL.md` (Vercel) and review the changed UI. Preserve Vietnamese copy and mobile-first flow from the spec.
- Vercel deployment planning or execution: read `../personal-os-deploy/SKILL.md` and its linked Vercel skills. Deployment requires a separate user request.

Apply only rules relevant to the changed files. Skip Next.js-specific advice in this React/Vite app. Do not add dependencies, infrastructure, or product features from a skill alone. Verify code changes with `./init.sh` and focused checks; build FE when requested or when preparing deployment. Keep test, build, server, browser, and deployment evidence separate. Do not run `deploy.sh` for ordinary code, test, commit, or push work.
