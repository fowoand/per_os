---
name: personal-os-ui
description: Apply Personal OS Radiant design system to UI changes; use for every apps/web design, component, CSS, or page task.
---

# Personal OS UI

Read `DESIGN.md` and `doc/design/radiant.css` before UI coding. The CSS file is
the single source for tokens and shared visual components. The independent
`doc/design/prototype.html` shows the intended dashboard feel; its numbers are
illustrative and must never enter app data.

Use existing `po-*` classes for visual treatments. Screen CSS may define layout
and responsive placement; it must not invent colors, spacing, typography,
radius, shadows, or another style for an existing component. For a genuinely
new visual pattern, update `radiant.css` and the prototype first, then use it
in the app. Keep real API data, Vietnamese copy, finance semantics, and the
current stage gate from `doc/spec_init_001.md`.

After each UI edit run `python3 scripts/check-ui-style.py`. A Codex project
hook reports drift after edits when trusted; `./init.sh` blocks drift for both
Codex and agy. The checker enforces CSS ownership, not rendered behavior.
Inspect all changed screens at 320px, 390px, both sides of the nav breakpoint,
and desktop. Check horizontal overflow, 44px touch targets, keyboard focus,
contrast, and loading/empty/error states. Exercise native inputs and stacked
dialogs: localized labels, Escape closing only the top dialog, and focus return.
Keep browser, real-phone, and static evidence separate.
