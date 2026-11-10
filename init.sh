#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
python3 scripts/check-ui-style.py
python3 scripts/test_ui_style.py
TEST_DATABASE_URL=postgresql://postgres:local-only@127.0.0.1:5432/personal_os_test npm test
npm run check
git diff --check
