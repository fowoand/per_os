#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
python3 scripts/check-ui-style.py
python3 scripts/test_ui_style.py
npm test
npm run check
git diff --check
