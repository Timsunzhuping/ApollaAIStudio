#!/usr/bin/env bash
# Liveness watchdog (S-ops). Polls /api/ready; on failure it retries once, then restarts the service
# and appends to a log. Cron: */5 * * * * /opt/apolla/infra/healthcheck.sh
# Optional: set ALERT_WEBHOOK to POST a JSON alert (e.g. a Slack/Feishu incoming webhook) on restart.
set -uo pipefail

URL="${HEALTH_URL:-http://127.0.0.1:8080/api/ready}"
SERVICE="${APOLLA_SERVICE:-apolla}"
LOG="${HEALTH_LOG:-/var/log/apolla-health.log}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

check() { curl -fs -m 8 "$URL" >/dev/null 2>&1; }

if check; then
  exit 0
fi
sleep 5
if check; then
  exit 0
fi

ts="$(date -Iseconds)"
echo "$ts unhealthy ($URL) — restarting $SERVICE" >> "$LOG"
systemctl restart "$SERVICE"

if [ -n "$ALERT_WEBHOOK" ]; then
  curl -fs -m 8 -X POST "$ALERT_WEBHOOK" \
    -H 'content-type: application/json' \
    -d "{\"text\":\"Apolla $SERVICE was unhealthy at $ts and has been restarted.\"}" >/dev/null 2>&1 || true
fi
