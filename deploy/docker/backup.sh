#!/usr/bin/env bash
# Pariksha Automated Backup Script (S-01, S-02)
# Usage: ./backup.sh [output_dir]

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_DIR="${BACKUP_DIR}/pariksha_backup_${TIMESTAMP}"

mkdir -p "${TARGET_DIR}"

echo "==> Starting Pariksha backup at ${TIMESTAMP}..."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
fi

# Detect whether Postgres or SQLite is active
if docker compose ps postgres 2>/dev/null | grep -q "postgres"; then
  echo "==> Detected Postgres container. Dumping database..."
  DB_USER="${POSTGRES_USER:-pariksha}"
  DB_NAME="${POSTGRES_DB:-pariksha}"
  docker compose exec -T postgres pg_dump -U "${DB_USER}" -d "${DB_NAME}" > "${TARGET_DIR}/database.sql"
  echo "==> Database dump completed: ${TARGET_DIR}/database.sql"
fi

if docker compose -f docker-compose.sqlite.yml ps pariksha 2>/dev/null | grep -q "pariksha"; then
  echo "==> Detected SQLite container. Backing up SQLite database file..."
  docker compose -f docker-compose.sqlite.yml cp pariksha:/app/data/pariksha.db "${TARGET_DIR}/pariksha.db"
  echo "==> SQLite backup completed: ${TARGET_DIR}/pariksha.db"
fi

# Create archive
ARCHIVE_PATH="${BACKUP_DIR}/pariksha_backup_${TIMESTAMP}.tar.gz"
tar -czf "${ARCHIVE_PATH}" -C "${BACKUP_DIR}" "pariksha_backup_${TIMESTAMP}"
rm -rf "${TARGET_DIR}"

echo "==> Backup successfully archived to: ${ARCHIVE_PATH}"
