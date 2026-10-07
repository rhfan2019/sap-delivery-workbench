#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
dc() { docker compose --env-file production.env -f compose.yaml "$@"; }
target="${1:?Usage: bash backup.sh /absolute/new-backup-directory}"
[[ "$target" = /* && ! -e "$target" ]] || { echo 'Use a new absolute directory.' >&2; exit 1; }
mkdir -p "$target"
# Stop all writers before capturing the database and attachment directory.
dc stop web api
trap 'dc up -d api web' EXIT
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$target/database.dump"
tar -czf "$target/files.tar.gz" -C data files
cp production.env "$target/production.env"
dc images --format json > "$target/images.json"
(cd "$target" && sha256sum database.dump files.tar.gz production.env images.json > SHA256SUMS)
echo 'Backup completed. Encrypt and copy this directory off the CVM; it contains secrets.'
