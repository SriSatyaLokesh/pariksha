#!/usr/bin/env bash
# Pariksha Restore Script (S-01, S-02)
# Usage: ./restore.sh <backup_archive.tar.gz>

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path_to_backup_archive.tar.gz>"
  exit 1
fi

ARCHIVE_PATH="$1"
if [ ! -f "${ARCHIVE_PATH}" ]; then
  echo "Error: Archive file not found: ${ARCHIVE_PATH}"
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "==> Extracting backup archive..."
tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"

BACKUP_CONTENT_DIR=$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)

if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
fi

# Restore Postgres
if [ -f "${BACKUP_CONTENT_DIR}/database.sql" ]; then
  echo "==> Restoring Postgres database..."
  DB_USER="${POSTGRES_USER:-pariksha}"
  DB_NAME="${POSTGRES_DB:-pariksha}"
  docker compose exec -T postgres psql -U "${DB_USER}" -d "${DB_NAME}" < "${BACKUP_CONTENT_DIR}/database.sql"
  echo "==> Postgres restore complete."
fi

# Restore SQLite
if [ -f "${BACKUP_CONTENT_DIR}/pariksha.db" ]; then
  echo "==> Restoring SQLite database..."
  docker compose -f docker-compose.sqlite.yml cp "${BACKUP_CONTENT_DIR}/pariksha.db" pariksha:/app/data/pariksha.db
  docker compose -f docker-compose.sqlite.yml restart pariksha
  echo "==> SQLite restore complete."
fi

echo "==> Restore finished successfully."
