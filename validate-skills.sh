#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

validator="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py"
for skill in personal-os-coding personal-os-deploy personal-os-agy-coding personal-os-ui; do
  uv run --no-project --with PyYAML python "$validator" ".agents/skills/$skill"
done
