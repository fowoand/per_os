# Personal OS agent harness

- At task start, check `git status --short`, read `.agents/state.md`, then inspect the relevant current source and spec section. Preserve unrelated changes; old notes are context, not proof.
- Keep each task within the requested stage and feature. Use the spec's acceptance criteria; a known gap does not authorize unrelated work.
- Source of truth: `doc/spec_init_001.md`. Follow stages in section 12; finish each gate before next stage.
- For code, UI, or deployment work, load `.agents/skills/personal-os-coding/SKILL.md` and its task-matched skills before editing. Repo spec and these rules take precedence over generic skill examples.
- Current stage: 0 complete when `npm test`, `npm run check`, and `npm start` pass. Stage 1 needs all 17 cases in section 11 before UI work for matching rules.
- Keep `packages/core` pure: no PostgreSQL, HTTP, or UI imports. Server owns migrations, persistence, and transactions.
- Never store calculated balances. Money is integer VND; unknown debt balance stays `NULL`.
- Before adding `require`, `check`, or guards, trace caller, data source, and business flow. Do not invent fallback business data.
- Record only genuine spec ambiguities in `DECISIONS.md`. Ask before choosing an ambiguous financial formula.
- Choose checks for the change. Run `./init.sh` for code changes; documentation-only edits need link and diff checks. Separate test, typecheck, server, and phone/browser evidence; do not claim one from another.
- Preserve user data: numbered, repeatable migrations; no destructive migration or automatic seed on startup.
- At each stage gate, update `.agents/state.md` with result and next step. Before ending a task, review the final diff and report passed checks and untested behavior. Commit only when requested.
