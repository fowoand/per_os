---
name: personal-os-coding
description: Coordinate this repo's TypeScript, backend, UI design, and deployment skills for Personal OS code changes and reviews.
---

# Personal OS coding

Read `AGENTS.md`, `doc/spec_init_001.md`, and `.agents/state.md` before work. Follow the current stage and its test gate. Those files and the user's request override generic examples in installed skills.

## Required skill routing

- Every TypeScript change or review: read `../typescript-patterns/SKILL.md` (ECC).
- `packages/core` or `apps/server`: also read `../backend-patterns/SKILL.md` (ECC). Keep core pure, money as integer VND, and PostgreSQL transactions for multi-table writes. Do not add layers, caching, or services merely because the skill shows them.
- `apps/web` or other UI work: also read `../frontend-patterns/SKILL.md` (ECC), `../react-best-practices/SKILL.md` (Vercel), and `../impeccable/SKILL.md`. Use Impeccable for visual direction and rendered review. Before calling UI finished, read `../web-design-guidelines/SKILL.md` (Vercel) and review the changed UI. Preserve Vietnamese copy and mobile-first flow from the spec.
- Vercel deployment planning or execution: read `../deploy-to-vercel/SKILL.md` (Vercel). Deployment requires a separate user request. Configure a managed PostgreSQL URL and add authentication before exposing financial data online.

Apply only rules relevant to the changed files. Skip Next.js-specific advice in this React/Vite app. Do not add dependencies, infrastructure, or product features from a skill alone. Verify with `./init.sh` and the current stage's focused checks; report UI/device/deployment evidence separately.
