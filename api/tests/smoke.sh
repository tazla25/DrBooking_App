#!/usr/bin/env bash
#
# Dr_Booking v2 — end-to-end smoke test (Phase 4, contracts #1–33).
#
# Prerequisites:
#   1. Dev DB seeded:      cd api && bun run db:seed
#   2. API running:        bun run dev   (http://localhost:3000)
#
# Usage:
#   bash api/tests/smoke.sh                      # default base URL
#   SMOKE_BASE_URL=http://localhost:3000 bash api/tests/smoke.sh
#
# Re-runnable: every account/booking it creates uses timestamp-unique phone
# numbers against a FRESHLY registered doctor + schedule, so capacity and
# duplicate guards never saturate. Only the seeded SUPER_ADMIN
# (+919999000001 / Test@1234) is reused (read-only logins + admin actions).
#
# Exits non-zero on the first failing step (and prints a summary).

set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://localhost:3000}"
ADMIN_PHONE="919999000001"
ADMIN_PASS="Test@1234"
DEFAULT_PASS="Test@1234"

PASS_COUNT=0
STEP=""

# ---------------------------------------------------------------- helpers ----

IST() { TZ='Asia/Kolkata' date "$@"; }
TODAY="$(IST +%F)"
TOMORROW="$(IST -d '+1 day' +%F)"
TODAY_DOW="$(IST +%w)" # 0=Sunday..6=Saturday (IST business day)

TS="$(date +%s)"
uniq() { # uniq <offset 0-9> → 10-digit phone starting with 9, unique per run
  echo "9${TS: -8}$1"
}

# One synthetic client IP per run: keeps the per-IP register/login rate limits
# from blocking re-runs within their 15-minute window (the limiter keys on
# X-Forwarded-For — see README for the proxy-trust caveat). Limiter behavior
# itself is covered by the jest suite.
SMOKE_IP="10.$(( (TS / 65536) % 256 )).$(( (TS / 256) % 256 )).$(( TS % 256 ))"

P_PHONE="$(uniq 1)"    # patient created by this run
D_PHONE="$(uniq 2)"    # doctor created by this run
W_PHONE1="$(uniq 5)"   # walk-in 1
W_PHONE2="$(uniq 6)"   # walk-in 2
C_PHONE="$(uniq 7)"    # compounder

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

req() { # req <METHOD> <path> <json-body|-> [token]
  local method="$1" path="$2" body="$3" token="${4:-}"
  local args=(-s -o "$BODY_FILE" -w '%{http_code}' -X "$method"
    -H "x-forwarded-for: $SMOKE_IP" "$BASE$path")
  [ -n "$token" ] && args+=(-H "authorization: Bearer $token")
  if [ "$body" != "-" ] && [ -n "$body" ]; then
    args+=(-H 'content-type: application/json' -d "$body")
  fi
  # 000 = curl itself failed (server unreachable)
  STATUS="$(curl "${args[@]}" || echo '000')"
}

jget() { # jget <python-expr over d (parsed body)>
  python3 -c "
import json, sys
try:
    d = json.load(open('$BODY_FILE'))
except Exception:
    sys.exit(1)
try:
    print(eval(\"$1\"))
except Exception:
    sys.exit(1)
"
}

check() { # check <name> <expected-status>
  local name="$1" expected="$2"
  if [ "$STATUS" = "$expected" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '  ok  %-4s %s\n' "$STATUS" "$name"
  else
    printf '  FAIL %-4s %s (expected %s)\n' "$STATUS" "$name" "$expected"
    printf '       body: %s\n' "$(head -c 400 "$BODY_FILE")"
    printf '\nSMOKE FAILED at step: %s\n' "$STEP"
    exit 1
  fi
}

check_eq() { # check_eq <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '  ok   %s = %s\n' "$1" "$3"
  else
    printf '  FAIL %s: expected [%s], got [%s]\n' "$1" "$2" "$3"
    printf '\nSMOKE FAILED at step: %s\n' "$STEP"
    exit 1
  fi
}

section() { STEP="$1"; printf '\n== %s ==\n' "$1"; }

# ------------------------------------------------------------------ preflight

section "preflight"
req GET / -
check "GET / (service status)" 200
if ! command -v python3 >/dev/null; then
  echo "python3 is required for smoke.sh"; exit 1
fi

# ------------------------------------------------------------ phase 1: auth

section "auth (#1-5)"

STEP="register patient"
req POST /api/auth/register "{\"name\":\"Smoke Patient\",\"phone\":\"$P_PHONE\",\"password\":\"$DEFAULT_PASS\",\"role\":\"PATIENT\"}"
check "POST /api/auth/register (patient)" 201

STEP="register doctor (PENDING)"
req POST /api/auth/register "{\"name\":\"Dr Smoke $TS\",\"phone\":\"$D_PHONE\",\"password\":\"$DEFAULT_PASS\",\"role\":\"DOCTOR\"}"
check "POST /api/auth/register (doctor, starts PENDING)" 201

STEP="duplicate register"
req POST /api/auth/register "{\"name\":\"Dup\",\"phone\":\"$P_PHONE\",\"password\":\"$DEFAULT_PASS\",\"role\":\"PATIENT\"}"
check "POST /api/auth/register duplicate phone → 409" 409

STEP="login patient"
req POST /api/auth/login "{\"phone\":\"$P_PHONE\",\"password\":\"$DEFAULT_PASS\"}"
check "POST /api/auth/login (patient)" 200
P_TOKEN="$(jget "d['data']['token']")"

STEP="login doctor"
req POST /api/auth/login "{\"phone\":\"$D_PHONE\",\"password\":\"$DEFAULT_PASS\"}"
check "POST /api/auth/login (doctor)" 200
D_TOKEN="$(jget "d['data']['token']")"
D_USER_ID="$(jget "d['data']['user']['id']")"

STEP="login admin (seeded)"
req POST /api/auth/login "{\"phone\":\"$ADMIN_PHONE\",\"password\":\"$ADMIN_PASS\"}"
check "POST /api/auth/login (seeded SUPER_ADMIN)" 200
ADMIN_TOKEN="$(jget "d['data']['token']")"

STEP="me"
req GET /api/auth/me - "$P_TOKEN"
check "GET /api/auth/me" 200

STEP="wrong password"
req POST /api/auth/login "{\"phone\":\"$P_PHONE\",\"password\":\"WrongPass99\"}"
check "login wrong password → 401" 401

# unverified doctor is blocked from staff routes (existing gate)
STEP="unverified doctor blocked"
req GET /api/schedules - "$D_TOKEN"
check "GET /api/schedules as PENDING doctor → 403" 403

# --------------------------------------------------- phase 4: admin (#26-28)

section "admin (#26-28)"

STEP="pending doctors list"
req GET '/api/admin/pending-doctors?page=1&limit=50' - "$ADMIN_TOKEN"
check "GET /api/admin/pending-doctors" 200
check_eq "pending list contains the new doctor" "True" "$(jget "any(i['id']=='$D_USER_ID' for i in d['data']['items'])")"
D_PROFILE_ID="$(jget "[i['doctorProfile']['id'] for i in d['data']['items'] if i['id']=='$D_USER_ID'][0]")"

STEP="pending doctors list is admin-only"
req GET /api/admin/pending-doctors - "$P_TOKEN"
check "GET /api/admin/pending-doctors as patient → 403" 403

STEP="verify doctor"
req POST /api/admin/verify-doctor "{\"userId\":\"$D_USER_ID\",\"decision\":\"VERIFIED\",\"note\":\"smoke $TS\"}" "$ADMIN_TOKEN"
check "POST /api/admin/verify-doctor (PENDING→VERIFIED)" 200

STEP="verify doctor idempotent"
req POST /api/admin/verify-doctor "{\"userId\":\"$D_USER_ID\",\"decision\":\"VERIFIED\"}" "$ADMIN_TOKEN"
check "POST /api/admin/verify-doctor (idempotent VERIFIED→VERIFIED)" 200

STEP="verify doctor 404"
req POST /api/admin/verify-doctor '{"userId":"no-such-user","decision":"VERIFIED"}' "$ADMIN_TOKEN"
check "POST /api/admin/verify-doctor unknown user → 404" 404

STEP="audit log"
req GET '/api/admin/audit-log?limit=10' - "$ADMIN_TOKEN"
check "GET /api/admin/audit-log" 200
check_eq "audit row for the verification exists" "True" "$(jget "d['data']['total'] >= 1")"
req GET '/api/admin/audit-log?action=DOCTOR_VERIFIED&limit=5' - "$ADMIN_TOKEN"
check "GET /api/admin/audit-log?action=DOCTOR_VERIFIED" 200
check_eq "filtered audit rows all DOCTOR_VERIFIED" "True" "$(jget "all(i['action']=='DOCTOR_VERIFIED' for i in d['data']['items'])")"

# ------------------------------------------- phase 2: schedules & overrides

section "schedules + overrides (#19-22)"

STEP="create schedule"
req POST /api/schedules "{\"dayOfWeek\":$TODAY_DOW,\"startTime\":\"09:00\",\"endTime\":\"13:00\",\"clinicName\":\"Smoke Clinic $TS\",\"clinicAddress\":\"1 Test Street\",\"pinCode\":\"560001\"}" "$D_TOKEN"
check "POST /api/schedules (today, verified doctor)" 201
SCHEDULE_ID="$(jget "d['data']['schedule']['id']")"

STEP="list schedules"
req GET /api/schedules - "$D_TOKEN"
check "GET /api/schedules" 200

STEP="update schedule"
req PUT "/api/schedules/$SCHEDULE_ID" "{\"dayOfWeek\":$TODAY_DOW,\"startTime\":\"09:00\",\"endTime\":\"13:30\",\"clinicName\":\"Smoke Clinic $TS\",\"clinicAddress\":\"1 Test Street\"}" "$D_TOKEN"
check "PUT /api/schedules/:id" 200

STEP="create override (CLOSED tomorrow)"
req POST "/api/schedules/$SCHEDULE_ID/overrides" "{\"date\":\"$TOMORROW\",\"type\":\"CLOSED\",\"reason\":\"smoke holiday\"}" "$D_TOKEN"
check "POST /api/schedules/:id/overrides" 201

STEP="list overrides"
req GET "/api/schedules/$SCHEDULE_ID/overrides" - "$D_TOKEN"
check "GET /api/schedules/:id/overrides" 200

STEP="delete override"
req DELETE "/api/schedules/$SCHEDULE_ID/overrides/$TOMORROW" - "$D_TOKEN"
check "DELETE /api/schedules/:id/overrides/:date" 200

# --------------------------------------------- phase 3: public discovery

section "public discovery (#6-7, #32)"

STEP="doctor list"
req GET "/api/doctors?q=Dr%20Smoke%20$TS" -
check "GET /api/doctors?q= (finds the new doctor)" 200
check_eq "exactly one match" "1" "$(jget "d['data']['total']")"

STEP="doctor detail"
req GET "/api/doctors/$D_PROFILE_ID" -
check "GET /api/doctors/:id" 200

STEP="availability today"
req GET "/api/schedules/$SCHEDULE_ID/availability?date=$TODAY" -
check "GET /api/schedules/:id/availability?date=today" 200
check_eq "open today" "True" "$(jget "d['data']['open']")"

STEP="availability tomorrow (not the scheduled weekday)"
req GET "/api/schedules/$SCHEDULE_ID/availability?date=$TOMORROW" -
check "GET /api/schedules/:id/availability?date=tomorrow" 200
check_eq "NOT_SCHEDULED_DAY" "NOT_SCHEDULED_DAY" "$(jget "d['data']['reason']")"

# ------------------------------------------- phase 3: booking + queue flow

section "booking + queue (#8-12, #33)"

STEP="register device"
# Plain unknown-format token: registers the device row WITHOUT triggering a
# real Expo push later (unknown token shape → skipped with a log by push.ts).
req POST /api/devices "{\"token\":\"smoke-device-token-$TS\",\"platform\":\"android\"}" "$P_TOKEN"
check "POST /api/devices" 200

STEP="patient books"
req POST /api/appointments "{\"scheduleId\":\"$SCHEDULE_ID\",\"date\":\"$TODAY\"}" "$P_TOKEN"
check "POST /api/appointments (booking)" 201
P_APPT_ID="$(jget "d['data']['appointment']['id']")"
check_eq "position is 1" "1" "$(jget "d['data']['position']")"

STEP="duplicate booking blocked"
req POST /api/appointments "{\"scheduleId\":\"$SCHEDULE_ID\",\"date\":\"$TODAY\"}" "$P_TOKEN"
check "duplicate booking → 409" 409

STEP="my appointments"
req GET /api/appointments/mine - "$P_TOKEN"
check "GET /api/appointments/mine" 200
check_eq "mine has the booking" "1" "$(jget "d['data']['total']")"

STEP="staff walk-in"
req POST /api/appointments/walk-in "{\"scheduleId\":\"$SCHEDULE_ID\",\"date\":\"$TODAY\",\"patientName\":\"Smoke Walkin One\",\"patientPhone\":\"$W_PHONE1\"}" "$D_TOKEN"
check "POST /api/appointments/walk-in" 201
check_eq "walk-in queueNumber 2" "2" "$(jget "d['data']['appointment']['queueNumber']")"

STEP="queue today (staff)"
req GET /api/queue/today - "$D_TOKEN"
check "GET /api/queue/today" 200

STEP="queue next #1"
req POST /api/queue/next '{}' "$D_TOKEN"
check "POST /api/queue/next (call patient #1)" 200
check_eq "#1 now CALLED" "True" "$(jget "d['data']['called']['queueNumber'] == 1")"

STEP="queue next #2"
req POST /api/queue/next '{}' "$D_TOKEN"
check "POST /api/queue/next (complete #1, call #2)" 200
check_eq "#1 completed" "True" "$(jget "d['data']['completed']['queueNumber'] == 1")"

STEP="queue next #3"
req POST /api/queue/next '{}' "$D_TOKEN"
check "POST /api/queue/next (complete #2, queue empty)" 200
check_eq "queueEmpty" "True" "$(jget "d['data']['queueEmpty']")"

STEP="feedback on completed visit"
req POST /api/feedback "{\"appointmentId\":\"$P_APPT_ID\",\"rating\":5,\"comment\":\"smoke run $TS\"}" "$P_TOKEN"
check "POST /api/feedback (COMPLETED appointment)" 201

STEP="re-book after completion"
req POST /api/appointments "{\"scheduleId\":\"$SCHEDULE_ID\",\"date\":\"$TODAY\"}" "$P_TOKEN"
check "POST /api/appointments (re-book)" 201
P_APPT2_ID="$(jget "d['data']['appointment']['id']")"

STEP="cancel own booking"
req POST "/api/appointments/$P_APPT2_ID/cancel" '{}' "$P_TOKEN"
check "POST /api/appointments/:id/cancel" 200

STEP="public queue screen"
req GET "/api/queue/$SCHEDULE_ID/$TODAY" -
check "GET /api/queue/:scheduleId/:date (public)" 200
check_eq "counts present" "True" "$(jget "'completed' in d['data']['counts'] and 'waiting' in d['data']['counts']")"

# --------------------------------------- phase 2: status machine + patients

section "status machine + patients + notes (#18, #21-22)"

STEP="second walk-in"
req POST /api/appointments/walk-in "{\"scheduleId\":\"$SCHEDULE_ID\",\"date\":\"$TODAY\",\"patientName\":\"Smoke Walkin Two\",\"patientPhone\":\"$W_PHONE2\"}" "$D_TOKEN"
check "POST /api/appointments/walk-in (second)" 201
W2_APPT_ID="$(jget "d['data']['appointment']['id']")"

STEP="staff cancel (push trigger c)"
req POST "/api/appointments/$W2_APPT_ID/status" '{"status":"CANCELLED"}' "$D_TOKEN"
check "POST /api/appointments/:id/status CANCELLED" 200

STEP="terminal resurrection blocked"
req POST "/api/appointments/$W2_APPT_ID/status" '{"status":"CONFIRMED"}' "$D_TOKEN"
check "terminal → CONFIRMED → 422/409" 422

STEP="patients list"
req GET /api/patients - "$D_TOKEN"
check "GET /api/patients" 200

STEP="create note"
req POST "/api/patients/$W_PHONE1/notes" '{"note":"smoke note","isImportant":false}' "$D_TOKEN"
check "POST /api/patients/:phone/notes" 201

STEP="list notes"
req GET "/api/patients/$W_PHONE1/notes" - "$D_TOKEN"
check "GET /api/patients/:phone/notes" 200

# ------------------------------------------ phase 2: compounders + availab.

section "compounders + availability (#23-25)"

STEP="create compounder"
req POST /api/compounders "{\"name\":\"Smoke Compounder\",\"phone\":\"$C_PHONE\"}" "$D_TOKEN"
check "POST /api/compounders" 201
C_ID="$(jget "d['data']['user']['id']")"
TEMP_PW="$(jget "d['data']['tempPassword']")"

STEP="compounder logs in with temp password"
req POST /api/auth/login "{\"phone\":\"$C_PHONE\",\"password\":\"$TEMP_PW\"}"
check "login with one-time tempPassword" 200

STEP="list compounders"
req GET /api/compounders - "$D_TOKEN"
check "GET /api/compounders" 200

STEP="deactivate compounder"
req DELETE "/api/compounders/$C_ID" - "$D_TOKEN"
check "DELETE /api/compounders/:id" 200

STEP="availability toggle"
req PATCH /api/availability '{"isAvailableNow":true}' "$D_TOKEN"
check "PATCH /api/availability" 200

# ------------------------------------------- phase 4: analytics + export

section "analytics + export (#29-31)"

STEP="analytics summary (own scope)"
req GET /api/analytics/summary - "$D_TOKEN"
check "GET /api/analytics/summary" 200
check_eq "today booked = 4 (2 online + 2 walk-ins)" "4" "$(jget "d['data']['today']['booked']")"
check_eq "today completed = 2" "2" "$(jget "d['data']['today']['completed']")"
check_eq "today walkIns = 2" "2" "$(jget "d['data']['today']['walkIns']")"

STEP="analytics summary admin without target"
req GET /api/analytics/summary - "$ADMIN_TOKEN"
check "GET /api/analytics/summary (admin, no doctorId) → 422" 422

STEP="analytics summary admin targeted"
req GET "/api/analytics/summary?doctorId=$D_PROFILE_ID" - "$ADMIN_TOKEN"
check "GET /api/analytics/summary?doctorId= (admin)" 200

STEP="revenue series"
req GET '/api/analytics/revenue?days=7' - "$D_TOKEN"
check "GET /api/analytics/revenue?days=7" 200
check_eq "7 zero-filled days" "7" "$(jget "len(d['data']['series'])")"

STEP="CSV export"
req GET "/api/export/appointments?from=$TODAY&to=$TODAY" - "$D_TOKEN"
check "GET /api/export/appointments (text/csv)" 200
CSV_TYPE="$(curl -s -o /dev/null -w '%{content_type}' "$BASE/api/export/appointments?from=$TODAY&to=$TODAY" -H "authorization: Bearer $D_TOKEN")"
case "$CSV_TYPE" in
  text/csv*) PASS_COUNT=$((PASS_COUNT + 1)); printf '  ok   content-type text/csv\n' ;;
  *) printf '  FAIL content-type: got [%s]\n' "$CSV_TYPE"; printf '\nSMOKE FAILED at step: %s\n' "$STEP"; exit 1 ;;
esac
CSV_FIRST="$(head -n 1 "$BODY_FILE" | sed 's/^\xEF\xBB\xBF//')"
check_eq "CSV header row" "date,queueNumber,patientName,phone,doctorName,clinicName,status,source,fee" "$CSV_FIRST"
check_eq "CSV rows (header + 4 data)" "5" "$(grep -c . "$BODY_FILE")"
check_eq "phone cells formula-escaped" "True" "$(python3 -c "
import sys
csv_lines = open('$BODY_FILE', encoding='utf-8-sig').read().splitlines()
ok = all(not l.split(',')[3].startswith('+') or l.split(',')[3].startswith(chr(39)) for l in csv_lines[1:])
print(ok)
")"

# ------------------------------------------------ auth lifecycle + hardening

section "auth lifecycle + hardening"

STEP="change password"
NEW_PW="SmokeRun$TS"
req POST /api/auth/change-password "{\"currentPassword\":\"$DEFAULT_PASS\",\"newPassword\":\"$NEW_PW\"}" "$P_TOKEN"
check "POST /api/auth/change-password" 200

STEP="login with the new password"
req POST /api/auth/login "{\"phone\":\"$P_PHONE\",\"password\":\"$NEW_PW\"}"
check "login with changed password" 200

STEP="logout"
req POST /api/auth/logout '{}' "$P_TOKEN"
check "POST /api/auth/logout" 200

STEP="me after logout"
req GET /api/auth/me - "$P_TOKEN"
check "GET /api/auth/me after logout → 401" 401

STEP="catch-all 404"
req GET /api/definitely/not/a/route -
check "GET /api/<unknown> → 404" 404
check_eq "NOT_FOUND envelope" "NOT_FOUND" "$(jget "d['error']['code']")"

STEP="security headers"
HEADER_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/doctors")"
check_eq "GET /api/doctors reachable" "200" "$HEADER_STATUS"
for h in 'x-content-type-options: nosniff' 'x-frame-options: DENY' 'referrer-policy: strict-origin-when-cross-origin'; do
  if curl -s -D - -o /dev/null "$BASE/api/doctors" | tr -d '\r' | grep -qi "^$h\$"; then
    PASS_COUNT=$((PASS_COUNT + 1)); printf '  ok   header %s\n' "$h"
  else
    printf '  FAIL missing header %s\n' "$h"
    printf '\nSMOKE FAILED at step: %s\n' "$STEP"; exit 1
  fi
done

# ------------------------------------------------------------------- summary

printf '\nALL %d SMOKE CHECKS PASSED\n' "$PASS_COUNT"
printf 'run timestamp: %s (IST today: %s)\n' "$TS" "$TODAY"
