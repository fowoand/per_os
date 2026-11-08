---
name: personal-os-agy-coding
description: Delegate bounded Personal OS coding tasks to Antigravity CLI (agy) with Claude Sonnet 4.6 while Codex reviews and verifies. Use when the user asks Codex to have agy implement code in this repo.
---

# Personal OS coding through agy

Codex owns task scope, financial decisions, review, checks, and final report. Agy writes the assigned code; its response is not verification.

1. Read `AGENTS.md`, `.agents/state.md`, relevant current source, and matching sections of `doc/spec_init_001.md` and `doc/development_workflow.md`. Load `../personal-os-coding/SKILL.md` and its task-matched skills. Check `git status --short` first; preserve existing changes.
2. Split work along stage gates and, for UI, by screen or shared component group. Give agy one bounded task with allowed files, acceptance cases, and exclusions. Stage 1 business rules need the 17 independent core tests from spec section 11 before matching UI work. Ask the user about ambiguous financial formulas before implementation.
3. From the `dev` checkout, run `agy --model claude-sonnet-4-6 --mode accept-edits --output-format json --print '<task>'`. Use `--mode plan` for read-only analysis. Instruct agy to follow repo rules, use local PostgreSQL only, preserve dirty work, and avoid commit, push, seed, and deploy. Keep secrets out of prompts. Do not use `--dangerously-skip-permissions` by default.
4. Check exit code, JSON `status`, changed files, and full diff. Agy `status: ERROR` means incomplete handoff even if files changed or checks passed. Review business rules, integer VND, unknown debt as `NULL`, migration safety, and out-of-scope edits. Fix small defects or send one focused follow-up with `--conversation <id>`; take over if the same issue persists.
5. For any UI assignment, include `DESIGN.md` and `.agents/skills/personal-os-ui/SKILL.md` in the agy prompt and require `python3 scripts/check-ui-style.py` after its edits. Codex runs the UI skill's rendered checklist independently. Run `./init.sh` after code changes, plus focused checks. Build frontend only when requested or preparing deployment. Keep test, typecheck, server, browser, and phone evidence separate. Update `.agents/state.md` only at an actual stage gate. Report remaining gaps.

Use separate worktrees for independent parallel edits. Never run `deploy.sh dev` or `deploy.sh prod` without a separate deployment request.
