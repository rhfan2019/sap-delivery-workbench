#!/usr/bin/env bash
# First deployment only: from an empty database to one ready for the application.
# Refuses a database that already holds data, so running it twice changes nothing.
set -euo pipefail
umask 077
cd "$(dirname "$0")"
dc() { docker compose --env-file production.env -f compose.yaml "$@"; }
[[ -f production.env ]] || { echo 'production.env not found; see README.md.' >&2; exit 1; }
mkdir -p secrets

dc --profile ops build tooling
dc up -d --wait postgres
dc exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < ../../database/init/init-database.sql > /dev/null
dc --profile ops run --rm tooling node scripts/database/provision.mjs
dc --profile ops run --rm tooling node scripts/database/bootstrap.mjs

cat <<'DONE'

Database ready. Next:
  1. sudo cat secrets/organization.env, and copy DEFAULT_ORGANIZATION_ID into production.env.
  2. sudo cat secrets/initial-login.txt for the temporary admin password. Do not share it.
  3. Start the application as described in README.md.
DONE
