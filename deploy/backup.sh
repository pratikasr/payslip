#!/usr/bin/env bash
# Encrypted backup of both Payslip data volumes to S3. Each volume (the encrypted seed, wallet.db,
# payslip.db and the viewer scan caches) is archived while its service is paused, encrypted with
# age to the public key in payslip.env, and uploaded to s3://BACKUP_BUCKET/<stamp>/. The upload
# uses the instance role (deploy/aws/provision.sh), so no AWS keys live on the host.
#
#   sudo deploy/backup.sh              # once, by hand
#   /etc/cron.d/payslip-backup         # nightly, written by install.sh
#
# Restore: deploy/README.md, "Restore from a backup".
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE=${PAYSLIP_ENV_FILE:-$DEPLOY_DIR/payslip.env}
COMPOSE_FILE=$DEPLOY_DIR/compose.yml
if [[ ! -f $ENV_FILE ]]; then
  echo "missing $ENV_FILE" >&2
  exit 1
fi

# One value from the env file, without sourcing it (values may hold spaces or shell characters).
envval() {
  local raw
  raw=$(sed -n "s/^$1=//p" "$ENV_FILE" | head -1)
  raw=${raw#\'}; raw=${raw%\'}
  raw=${raw#\"}; raw=${raw%\"}
  printf '%s' "$raw"
}
BUCKET=$(envval BACKUP_BUCKET)
RECIPIENT=$(envval BACKUP_AGE_RECIPIENT)
REGION=$(envval AWS_REGION)
REGION=${REGION:-us-east-1}
if [[ -z $BUCKET || -z $RECIPIENT ]]; then
  echo "set BACKUP_BUCKET and BACKUP_AGE_RECIPIENT in $ENV_FILE" >&2
  exit 1
fi
for tool in docker age aws; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not installed (deploy/install.sh)" >&2; exit 1; }
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
cleanup() {
  rm -rf "$WORK"
  # Never leave a service paused, whatever happened above.
  compose unpause app-service books-service >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Compose names volumes <project>_<volume>; the project is "payslip" (compose.yml: name).
for pair in app-service:payslip_app-data books-service:payslip_books-data; do
  service=${pair%%:*}
  volume=${pair#*:}
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "volume $volume does not exist yet, skipping"
    continue
  fi
  out="$WORK/${volume}-${STAMP}.tar.gz.age"
  # Pausing the service for the few seconds of the copy makes the SQLite files (db, wal, shm)
  # a consistent set; a running container is paused, a stopped one is simply not running.
  compose pause "$service" >/dev/null 2>&1 || true
  docker run --rm -v "$volume:/data:ro" alpine:3.20 tar -C /data -czf - . \
    | age -r "$RECIPIENT" -o "$out"
  compose unpause "$service" >/dev/null 2>&1 || true
  aws s3 cp --region "$REGION" --only-show-errors "$out" "s3://$BUCKET/$STAMP/$(basename "$out")"
  echo "$(date -u +%FT%TZ) uploaded s3://$BUCKET/$STAMP/$(basename "$out") ($(du -h "$out" | cut -f1))"
done
