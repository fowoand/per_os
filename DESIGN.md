# Personal OS visual system: Radiant

## Direction

Use `doc/design/reference-radiant.jpg` for material and atmosphere: deep navy canvas,
restrained cyan and violet ambient light, translucent dark surfaces, fine borders,
and bright, legible figures. Personal OS remains a Vietnamese finance tool. Keep
actions, balances, and payment status ahead of decoration; do not copy the
reference's marketing hero, wording, navigation, or sample metrics.

## Source of truth

`doc/design/radiant.css` owns all visual tokens and shared component styles.
Import it before screen CSS. Do not duplicate token values in this document,
the UI skill, or screen CSS. A new token or component variant requires an
intentional edit to that file and a prototype update before application use.

## UI grammar

- Canvas: dark navy with ambient light behind content, never behind text at a
  strength that hurts contrast. Glass surfaces use one border and restrained blur.
- Type: body text stays readable; display type highlights the main financial
  figure, not marketing copy. Tabular numerals align amounts. Secondary text is
  visibly subordinate but still passes contrast.
- Spacing: use the shared 4px-based scale. Tight rows use smaller steps; page
  sections use larger steps. Radius and shadow come from tokens.
- Components: reuse shared nav, surface, metric, button, input, list row, status,
  and dialog classes. A class with only layout rules may stay local. Do not
  invent a second visual treatment for an existing control.
- Semantics: cyan marks primary action; green marks positive or completed;
  amber marks attention; red marks destructive or error. Pair color with text.
- Motion: short transitions on interactive states only. Respect reduced motion.
- Mobile: primary money and `+ Ghi chi tiêu` remain visible early; columns
  become a usable single-column flow, not squeezed desktop cards. Keep bottom
  navigation and touch targets usable.

## Change contract

Before UI edits, read this file and `.agents/skills/personal-os-ui/SKILL.md`.
Reuse classes in `doc/design/radiant.css`. Run `python3 scripts/check-ui-style.py`
after edits and `./init.sh` before completion. Inspect rendered desktop and
phone views; static checks alone do not prove visual quality. App screen CSS
contains layout only; visual styles live in `doc/design/radiant.css`.
