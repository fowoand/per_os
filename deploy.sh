#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

case "${1:-}" in
  dev) branch=dev; target=preview; api_alias=personal-os-api-dev.vercel.app; web_alias=personal-os-web-dev.vercel.app ;;
  prod) branch=main; target=production ;;
  *) echo 'Usage: ./deploy.sh dev|prod' >&2; exit 2 ;;
esac

if [ "$(git branch --show-current)" != "$branch" ]; then
  echo "Deploy $1 from branch $branch" >&2
  exit 1
fi
if ! git diff --quiet HEAD -- apps/server apps/web packages/core package.json package-lock.json; then
  echo 'Commit app changes before deploy' >&2
  exit 1
fi
if [ -n "$(git ls-files --others --exclude-standard -- apps/server apps/web packages/core)" ]; then
  echo 'Commit new app files before deploy' >&2
  exit 1
fi

./init.sh
npm run build -w @personal-os/web

for app in server web; do
  project=personal-os-api
  [ "$app" = web ] && project=personal-os-web
  vercel project inspect --cwd "apps/$app" --json --scope huangans-projects |
    jq -e --arg name "$project" '.name == $name and .rootDirectory == null' >/dev/null
done

if [ "$target" = production ]; then
  deploy_options='--prod --skip-domain'
else
  deploy_options='--environment preview'
fi

api_result=$(cd apps/server && vercel deploy $deploy_options --yes --json --scope huangans-projects)
api_url=$(printf '%s' "$api_result" | jq -er '.deployment.url')
vercel curl "$api_url/health" --scope huangans-projects -- --silent --show-error --max-time 20 |
  jq -e '.status == "ok" and (.schemaVersion >= 1)' >/dev/null

web_result=$(cd apps/web && vercel deploy $deploy_options --yes --json --scope huangans-projects)
web_url=$(printf '%s' "$web_result" | jq -er '.deployment.url')
web_status=$(vercel curl "$web_url" --scope huangans-projects -- --silent --show-error --max-time 20 -o /dev/null -w '%{http_code}')
[ "$web_status" = 200 ]

if [ "$target" = production ]; then
  vercel promote "$api_url" --scope huangans-projects --yes
  vercel promote "$web_url" --scope huangans-projects --yes
else
  vercel alias set "$api_url" "$api_alias" --scope huangans-projects
  vercel alias set "$web_url" "$web_alias" --scope huangans-projects
fi

printf 'API: %s/health\nWeb: %s\n' "$api_url" "$web_url"
