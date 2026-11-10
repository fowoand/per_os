#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop chưa chạy." >&2
  exit 1
fi

if [ ! -f .env.neon.local ]; then
  echo "Thiếu .env.neon.local (DATABASE_URL Neon dev)." >&2
  exit 1
fi

expected_version=11
version=$(docker run --rm --env-file .env.neon.local postgres:18 sh -c \
  'psql "$DATABASE_URL_UNPOOLED" -Atqc "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"')
case "$version" in
  ''|*[!0-9]*) echo "Không đọc được schema Neon dev." >&2; exit 1 ;;
esac
if [ "$version" -gt "$expected_version" ]; then
  echo "Neon schema $version mới hơn code local ($expected_version)." >&2
  exit 1
fi
if [ "$version" -lt "$expected_version" ]; then
  echo "Neon schema $version; sao lưu và thử khôi phục trước migration $expected_version."
  ./scripts/backup-postgres.sh
fi

docker compose up -d --build

attempt=0
until curl --fail --silent http://127.0.0.1:3000/health >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Backend chưa sẵn sàng. Xem log bằng: docker compose logs api" >&2
    exit 1
  fi
  sleep 2
done

echo "Backend:  http://localhost:3000/health"
echo "Frontend: http://localhost:4173"
echo "DB app: Neon dev; DB test: PostgreSQL local. Không seed Neon."
