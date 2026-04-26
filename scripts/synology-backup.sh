#!/bin/bash
# SSJ Database Weekly Backup — runs on Synology via Task Scheduler
# Uses Docker (already installed) to run pg_dump — no extra software needed.
#
# Setup:
#   1. Fill in SUPABASE_DB_URL below
#   2. Upload this file to /volume1/docker/scripts/ssj-backup.sh
#   3. chmod +x /volume1/docker/scripts/ssj-backup.sh
#   4. Synology Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script
#      Schedule: Daily, 2:00 AM
#      Command: bash /volume1/docker/scripts/ssj-backup.sh

# ── CONFIG ────────────────────────────────────────────────
SUPABASE_DB_URL="postgresql://postgres:Sunsea%4088@db.uppyxzellmuissdlxsmy.supabase.co:5432/postgres"
BACKUP_DIR="/volume1/docker/backups/ssj-db"
KEEP_DAYS=30   # keep last 30 days of daily backups
# ──────────────────────────────────────────────────────────

DATE=$(date +%Y-%m-%d)
FILENAME="ssj-db-${DATE}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup → $FILEPATH"

# Use Docker postgres image to run pg_dump
# --sysctl disables IPv6 inside container so it connects via IPv4 only
docker run --rm \
  --sysctl net.ipv6.conf.all.disable_ipv6=1 \
  postgres:16-alpine \
  pg_dump "${SUPABASE_DB_URL}?sslmode=require" \
  --no-owner --no-acl --clean \
  | gzip > "$FILEPATH"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$FILEPATH" | cut -f1)
  echo "[$(date)] Backup complete: $FILENAME ($SIZE)"
else
  echo "[$(date)] ERROR: backup failed"
  rm -f "$FILEPATH"
  exit 1
fi

# Delete old backups
find "$BACKUP_DIR" -name "ssj-db-*.sql.gz" -mtime +${KEEP_DAYS} -delete
echo "[$(date)] Cleaned up backups older than ${KEEP_DAYS} days"

# List current backups
echo "[$(date)] Current backups:"
ls -lh "$BACKUP_DIR"
