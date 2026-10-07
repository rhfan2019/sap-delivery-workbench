#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
dc() { docker compose --env-file production.env -f compose.yaml "$@"; }
source_dir="${1:?Usage: bash restore.sh /absolute/backup-directory}"
[[ "$source_dir" = /* ]] || { echo 'Absolute backup directory required.' >&2; exit 1; }
(cd "$source_dir" && sha256sum -c SHA256SUMS)
# Restore only into an empty, separately provisioned recovery installation.
[[ ! -e data/files ]] || { echo 'Refusing to overwrite existing attachments.' >&2; exit 1; }
tables=$(dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''app'\''"')
[[ "$tables" = 0 ]] || { echo 'Refusing to overwrite an existing app schema.' >&2; exit 1; }
dc stop web api
dc exec -T postgres sh -c 'pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$source_dir/database.dump"
mkdir -p data
tar -xzf "$source_dir/files.tar.gz" -C data
chown -R 1000:1000 data/files
dc run --rm tooling node scripts/db-provision.mjs
echo 'Restore completed. Verify release/key compatibility, then start api/web and perform acceptance checks.'
