#!/usr/bin/env bash
# Nightly Postgres backup with rotation (S-ops). Dumps the Apolla DB from the docker container to
# $BACKUP_DIR and keeps the most recent $KEEP files. Cron: 0 3 * * * /opt/apolla/infra/backup.sh
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-infra-postgres-1}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-apolla}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/apolla}"
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/apolla-$stamp.sql.gz"

# pg_dump inside the container, gzip on the host. --clean/--if-exists → restorable onto an existing DB.
docker exec "$PG_CONTAINER" pg_dump --clean --if-exists -U "$PG_USER" "$PG_DB" | gzip > "$out"

# Fail loudly if the dump is suspiciously small (empty/broken) so cron mail surfaces it.
size=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out")
if [ "$size" -lt 1000 ]; then
  echo "backup FAILED: $out is only ${size} bytes" >&2
  exit 1
fi

# Rotate: keep the newest $KEEP dumps.
ls -1t "$BACKUP_DIR"/apolla-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "backup ok: $out (${size} bytes); $(ls -1 "$BACKUP_DIR"/apolla-*.sql.gz | wc -l) kept"
