#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop chưa chạy." >&2
  exit 1
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
echo "Seed lần đầu (thủ công): docker compose exec api npm run seed"
