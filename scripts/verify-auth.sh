#!/bin/bash
# Dr_Booking v2 — Phase 1 endpoint verification (run against localhost:3000).
# Exercises all 5 auth endpoints + edge cases; prints a PASS/FAIL table.

BASE="http://localhost:3000"
TRANSCRIPT="/home/z/my-project/download/auth-endpoint-verification.txt"
PASS=0; FAIL=0
OUT=""

req() { # method path [json_body] [token]
  local method="$1" path="$2" body="$3" token="$4"
  local args=(-s -o /tmp/resp.json -w '%{http_code}' -X "$method" "$BASE$path" -H 'content-type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  STATUS=$(curl "${args[@]}")
  RESP=$(cat /tmp/resp.json)
}

check() { # label expected_status [expected_pattern]
  local label="$1" expected="$2" pattern="$3"
  local verdict="FAIL"
  if [ "$STATUS" = "$expected" ]; then
    if [ -z "$pattern" ] || echo "$RESP" | grep -q "$pattern"; then
      verdict="PASS"; PASS=$((PASS+1))
    fi
  fi
  [ "$verdict" = "FAIL" ] && FAIL=$((FAIL+1))
  printf '%-50s %-4s  status=%s (want %s)\n' "$label" "$verdict" "$STATUS" "$expected"
  OUT+=$(printf '%-50s %-4s  status=%s (want %s)\n     %s\n' "$label" "$verdict" "$STATUS" "$expected" "${RESP:0:220}")
  OUT+=$'\n'
}

{
echo "=============================================================="
echo " Dr_Booking v2 — Phase 1 auth endpoint verification ($(date '+%Y-%m-%d %H:%M:%S'))"
echo " Base: $BASE"
echo "=============================================================="
} >> "$TRANSCRIPT"

echo "=== 1) GET / (service status) ==="
req GET "/"
check "GET / service status" 200 '"ok":true'

echo ""
echo "=== 2) POST /api/auth/register ==="
PHONE="9811122233"
req POST /api/auth/register "{\"name\":\"Curl Verify Patient\",\"phone\":\"$PHONE\",\"password\":\"Verify@123\",\"role\":\"PATIENT\"}"
check "register patient (happy path)" 201 '"ok":true'
req POST /api/auth/register "{\"name\":\"Duplicate\",\"phone\":\"$PHONE\",\"password\":\"Verify@123\",\"role\":\"PATIENT\"}"
check "register duplicate phone" 409 'PHONE_EXISTS'
req POST /api/auth/register '{"name":"Bad","phone":"12345","password":"Verify@123","role":"PATIENT"}'
check "register invalid phone (zod 422)" 422 'VALIDATION_ERROR'
req POST /api/auth/register '{"name":"Dr Curl","phone":"9811122244","password":"Verify@123","role":"DOCTOR"}'
check "register doctor starts PENDING" 201 'PENDING'

echo ""
echo "=== 3) POST /api/auth/login ==="
req POST /api/auth/login '{"phone":"9876543210","password":"WrongPass@1"}'
check "login wrong password (generic 401)" 401 'INVALID_CREDENTIALS'
req POST /api/auth/login '{"phone":"9876599999","password":"WrongPass@1"}'
check "login unknown phone (same 401)" 401 'INVALID_CREDENTIALS'
req POST /api/auth/login '{"phone":"9876543210","password":"Test@1234"}'
check "login seeded doctor (happy path)" 200 '"token"'
DOCTOR_TOKEN=$(echo "$RESP" | sed -n 's/.*"token":"\([0-9a-f]*\)".*/\1/p')
req POST /api/auth/login '{"phone":"9876543220","password":"Test@1234"}'
check "login compounder (mustChangePassword=true)" 200 'mustChangePassword":true'
req POST /api/auth/login '{"phone":"9876543299","password":"Test@1234"}'
check "login PENDING doctor allowed (flag visible)" 200 '"verificationStatus":"PENDING"'

echo ""
echo "=== 4) GET /api/auth/me ==="
req GET /api/auth/me "" "$DOCTOR_TOKEN"
check "me with valid token" 200 'Dr. Ananya Sharma'
req GET /api/auth/me
check "me without token (401)" 401 'UNAUTHORIZED'
req GET /api/auth/me "" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
check "me with garbage token (401)" 401 'UNAUTHORIZED'

echo ""
echo "=== 5) POST /api/auth/change-password ==="
req POST /api/auth/login "{\"phone\":\"$PHONE\",\"password\":\"Verify@123\"}"
PATIENT_TOKEN=$(echo "$RESP" | sed -n 's/.*"token":"\([0-9a-f]*\)".*/\1/p')
req POST /api/auth/change-password '{"currentPassword":"Nope@123","newPassword":"Rotate@123"}' "$PATIENT_TOKEN"
check "change-password wrong current (401)" 401 'INVALID_CREDENTIALS'
req POST /api/auth/change-password '{"currentPassword":"Verify@123","newPassword":"weak"}' "$PATIENT_TOKEN"
check "change-password weak new (422)" 422 'VALIDATION_ERROR'
req POST /api/auth/change-password '{"currentPassword":"Verify@123","newPassword":"Rotate@123"}' "$PATIENT_TOKEN"
check "change-password happy path" 200 'mustChangePassword":false'
req POST /api/auth/login "{\"phone\":\"$PHONE\",\"password\":\"Rotate@123\"}"
check "login with NEW password after change" 200 '"token"'
req GET /api/auth/me "" "$PATIENT_TOKEN"
check "old token still valid (own session kept)" 200 '"ok":true'

echo ""
echo "=== 6) POST /api/auth/logout ==="
req POST /api/auth/logout '{}' "$PATIENT_TOKEN"
check "logout (happy path)" 200 '"success":true'
req GET /api/auth/me "" "$PATIENT_TOKEN"
check "me after logout (401)" 401 'UNAUTHORIZED'

echo ""
echo "=== 7) Login lockout (5 failures / 15 min) ==="
LOCK_PHONE="9811122255"
req POST /api/auth/register "{\"name\":\"Lockout\",\"phone\":\"$LOCK_PHONE\",\"password\":\"Verify@123\",\"role\":\"PATIENT\"}"
for i in 1 2 3 4 5; do
  req POST /api/auth/login "{\"phone\":\"$LOCK_PHONE\",\"password\":\"Wrong@999\"}"
done
check "5th failure still 401 (not yet locked)" 401 'INVALID_CREDENTIALS'
req POST /api/auth/login "{\"phone\":\"$LOCK_PHONE\",\"password\":\"Verify@123\"}"
check "6th attempt locked even with correct password" 429 'ACCOUNT_LOCKED'

echo ""
printf '\n================ RESULT: %d passed, %d failed ================\n' "$PASS" "$FAIL"
OUT+=$(printf '\nRESULT: %d passed, %d failed\n' "$PASS" "$FAIL")
printf '%s\n' "$OUT" >> "$TRANSCRIPT"
echo "Transcript saved to $TRANSCRIPT"
