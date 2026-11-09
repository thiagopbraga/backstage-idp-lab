#!/usr/bin/env bash
# Exercises the FastFlow ownership policy with two guest identities:
#   ANA_TOKEN   -> user:default/ana.souza   (group:default/claims-squad)
#   BRUNO_TOKEN -> user:default/bruno.lima  (group:default/policy-squad)
#   ADMIN_TOKEN -> user:default/thiago.braga (group:default/fastflow, optional)
# Usage: BASE_URL=http://localhost:7007 ANA_TOKEN=... BRUNO_TOKEN=... [ADMIN_TOKEN=...] scripts/smoke-permissions.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:7007}"
: "${ANA_TOKEN:?ANA_TOKEN is required}"
: "${BRUNO_TOKEN:?BRUNO_TOKEN is required}"
FAILURES=0

status() { # status <token> <method> <path> [json body]
  local args=(-s -o /dev/null -w '%{http_code}' -X "$2" -H "Authorization: Bearer $1")
  [ $# -ge 4 ] && args+=(-H 'Content-Type: application/json' -d "$4")
  curl "${args[@]}" "$BASE_URL$3"
}

expect() { # expect <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  ok    %-60s %s\n' "$1" "$3"
  else
    printf '  FAIL  %-60s expected %s, got %s\n' "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}

decision() { # decision <token> <permission> <entityRef>
  curl -fsS -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    "$BASE_URL/api/permission/authorize" \
    -d "{\"items\":[{\"id\":\"1\",\"permission\":{\"type\":\"resource\",\"name\":\"$2\",\"attributes\":{},\"resourceType\":\"catalog-entity\"},\"resourceRef\":\"$3\"}]}" |
    jq -r '.items[0].result'
}

refresh() { status "$1" POST /api/catalog/refresh "{\"entityRef\":\"$2\"}"; }

CLAIMS=component:default/claims-api
POLICY=component:default/policy-quote-service

echo "--- reads stay open"
expect "ana reads $POLICY" 200 "$(status "$ANA_TOKEN" GET /api/catalog/entities/by-name/component/default/policy-quote-service)"
expect "bruno reads $CLAIMS" 200 "$(status "$BRUNO_TOKEN" GET /api/catalog/entities/by-name/component/default/claims-api)"

echo "--- catalog.entity.refresh (conditional: isEntityOwner)"
expect "ana refreshes $CLAIMS (owner)" 200 "$(refresh "$ANA_TOKEN" "$CLAIMS")"
expect "ana refreshes $POLICY (not owner)" 403 "$(refresh "$ANA_TOKEN" "$POLICY")"
expect "bruno refreshes $POLICY (owner)" 200 "$(refresh "$BRUNO_TOKEN" "$POLICY")"
expect "bruno refreshes $CLAIMS (not owner)" 403 "$(refresh "$BRUNO_TOKEN" "$CLAIMS")"

echo "--- catalog.entity.delete"
expect "decision: ana deletes $CLAIMS" ALLOW "$(decision "$ANA_TOKEN" catalog.entity.delete "$CLAIMS")"
expect "decision: ana deletes $POLICY" DENY "$(decision "$ANA_TOKEN" catalog.entity.delete "$POLICY")"
POLICY_UID=$(curl -fsS -H "Authorization: Bearer $ANA_TOKEN" \
  "$BASE_URL/api/catalog/entities/by-name/component/default/policy-quote-service" | jq -r .metadata.uid)
expect "ana DELETE $POLICY by uid" 403 "$(status "$ANA_TOKEN" DELETE "/api/catalog/entities/by-uid/$POLICY_UID")"

echo "--- scaffolder: owner-scoped fastflow:governance:validate"
run_task() {
  curl -fsS -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    "$BASE_URL/api/scaffolder/v2/tasks" \
    -d "{\"templateRef\":\"template:default/fastflow-nestjs-service\",\"values\":{\"name\":\"$2\",\"description\":\"permission smoke\",\"owner\":\"$3\",\"tier\":\"tier-2\",\"criticality\":\"high\",\"dataClassification\":\"confidential\",\"publishTarget\":\"local\"}}" |
    jq -r .id
}
wait_task() {
  local s=""
  for _ in $(seq 1 60); do
    s=$(curl -fsS -H "Authorization: Bearer $1" "$BASE_URL/api/scaffolder/v2/tasks/$2" | jq -r .status)
    case "$s" in completed | failed | cancelled) break ;; esac
    sleep 2
  done
  echo "$s"
}
DENIED=$(run_task "$ANA_TOKEN" policy-pricing-api group:default/policy-squad)
expect "ana scaffolds for policy-squad (not a member)" failed "$(wait_task "$ANA_TOKEN" "$DENIED")"
MSG=$(curl -fsS -H "Authorization: Bearer $ANA_TOKEN" "$BASE_URL/api/scaffolder/v2/tasks/$DENIED/events" |
  jq -r '[.[] | select(.body.status == "failed") | .body.message][0] // ""' | head -1)
echo "        $MSG"
expect "  ...denied by the policy" yes "$(echo "$MSG" | grep -q 'Unauthorized action: fastflow:governance:validate' && echo yes || echo no)"
ALLOWED=$(run_task "$BRUNO_TOKEN" policy-pricing-api group:default/policy-squad)
expect "bruno scaffolds for policy-squad (member)" completed "$(wait_task "$BRUNO_TOKEN" "$ALLOWED")"

echo "--- scaffolder tasks are private to their creator (isTaskOwner)"
expect "bruno reads ana's task" 403 "$(status "$BRUNO_TOKEN" GET "/api/scaffolder/v2/tasks/$DENIED")"
expect "ana reads her own task" 200 "$(status "$ANA_TOKEN" GET "/api/scaffolder/v2/tasks/$DENIED")"

if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "--- platform admin (break-glass)"
  expect "thiago refreshes $CLAIMS" 200 "$(refresh "$ADMIN_TOKEN" "$CLAIMS")"
  expect "thiago refreshes $POLICY" 200 "$(refresh "$ADMIN_TOKEN" "$POLICY")"
  expect "decision: thiago deletes $POLICY" ALLOW "$(decision "$ADMIN_TOKEN" catalog.entity.delete "$POLICY")"
  expect "thiago reads ana's task" 200 "$(status "$ADMIN_TOKEN" GET "/api/scaffolder/v2/tasks/$DENIED")"
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "permission smoke test FAILED ($FAILURES checks)"
  exit 1
fi
echo "permission smoke test passed"
