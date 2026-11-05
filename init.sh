#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
npm test
npm run check
git diff --check
