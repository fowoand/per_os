#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077

backup_dir=${PERSONAL_OS_BACKUP_DIR:-"$HOME/Library/Application Support/Personal OS/backups"}
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/personal-os-neon-dev-$stamp.dump"
tmp="$archive.tmp"
verify_db="personal_os_backup_verify_$$"

cleanup() {
  if [ "${created:-0}" -eq 1 ]; then
    docker compose exec -T db dropdb -U postgres "$verify_db" >/dev/null 2>&1 || true
  fi
  rm -f "$tmp"
}
trap cleanup EXIT HUP INT TERM

docker run --rm --env-file .env.neon.local postgres:18 sh -c \
  'pg_dump "$DATABASE_URL_UNPOOLED" -Fc --no-owner --no-acl' > "$tmp"
docker compose up -d --wait db >/dev/null
docker compose exec -T db createdb -U postgres "$verify_db"
created=1
docker compose exec -T db pg_restore -U postgres -d "$verify_db" --no-owner --no-acl --exit-on-error < "$tmp"
docker compose exec -T db psql -U postgres -d "$verify_db" -Atqc \
  'SELECT MAX(version) FROM schema_migrations' | grep -Eq '^[0-9]+$'
mv "$tmp" "$archive"
printf 'Neon dev backup verified: %s\n' "$archive"
