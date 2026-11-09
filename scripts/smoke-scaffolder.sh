#!/usr/bin/env bash
# Runs the FastFlow NestJS golden path twice through the scaffolder REST API:
#   1. an invalid request that must be rejected by fastflow:governance:validate
#   2. a valid request that must complete (offline, local publish)
# Usage: BASE_URL=http://localhost:7007 TOKEN=<backstage token> scripts/smoke-scaffolder.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:7007}"
: "${TOKEN:?TOKEN (Backstage user token) is required}"
TEMPLATE_REF="template:default/fastflow-nestjs-service"
AUTH=(-H "Authorization: Bearer $TOKEN")

# The template is ingested asynchronously: wait until the catalog serves it.
for i in $(seq 1 30); do
  if curl -fsS "${AUTH[@]}" "$BASE_URL/api/catalog/entities/by-name/template/default/fastflow-nestjs-service" >/dev/null 2>&1; then
    break
  fi
  echo "waiting for $TEMPLATE_REF ($i)"
  sleep 5
done

run_task() {
  local values="$1"
  curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' \
    -X POST "$BASE_URL/api/scaffolder/v2/tasks" \
    -d "{\"templateRef\":\"$TEMPLATE_REF\",\"values\":$values}" | jq -r .id
}

wait_task() {
  local id="$1" status=""
  for _ in $(seq 1 60); do
    status=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/scaffolder/v2/tasks/$id" | jq -r .status)
    case "$status" in completed | failed | cancelled) break ;; esac
    sleep 2
  done
  echo "$status"
}

echo "--- rejected run"
BAD_ID=$(run_task '{"name":"ClaimsIntake","description":"smoke","owner":"group:default/ghost-team","tier":"tier-1","criticality":"low","dataClassification":"internal","publishTarget":"local"}')
BAD_STATUS=$(wait_task "$BAD_ID")
BAD_MSG=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/scaffolder/v2/tasks/$BAD_ID/events" |
  jq -r '[.[] | select(.body.stepId == "governance" and .body.status == "failed") | .body.message][0] // ""')
echo "task $BAD_ID -> $BAD_STATUS"
echo "$BAD_MSG" | grep -v '^    at '
test "$BAD_STATUS" = failed
echo "$BAD_MSG" | grep -q 'FastFlow governance check failed'
echo "$BAD_MSG" | grep -q 'ghost-team'

echo "--- successful run"
GOOD_ID=$(run_task '{"name":"claims-smoke-api","description":"smoke","owner":"group:default/claims-squad","tier":"tier-2","criticality":"high","dataClassification":"confidential","publishTarget":"local"}')
GOOD_STATUS=$(wait_task "$GOOD_ID")
echo "task $GOOD_ID -> $GOOD_STATUS"
if [ "$GOOD_STATUS" != completed ]; then
  curl -fsS "${AUTH[@]}" "$BASE_URL/api/scaffolder/v2/tasks/$GOOD_ID/events" | jq -r '.[].body.message // empty' | tail -30
  exit 1
fi
echo "scaffolder smoke test passed"
