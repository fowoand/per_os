#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077

backup_dir=${PERSONAL_OS_BACKUP_DIR:-"$HOME/Library/Application Support/Personal OS/backups"}
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/personal-os-$stamp.dump"
tmp="$archive.tmp"
verify_db="personal_os_backup_verify_$$"

cleanup() {
  if [ "${created:-0}" -eq 1 ]; then
    docker compose exec -T db dropdb -U postgres "$verify_db" >/dev/null 2>&1 || true
  fi
  rm -f "$tmp"
}
trap cleanup EXIT HUP INT TERM

docker compose exec -T db pg_dump -U postgres -Fc personal_os > "$tmp"
docker compose exec -T db createdb -U postgres "$verify_db"
created=1
docker compose exec -T db pg_restore -U postgres -d "$verify_db" --exit-on-error < "$tmp"
docker compose exec -T db psql -U postgres -d "$verify_db" -Atqc \
  'SELECT MAX(version) FROM schema_migrations' | grep -Eq '^[0-9]+$'
mv "$tmp" "$archive"
printf 'Backup verified: %s\n' "$archive"
