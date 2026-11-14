#!/usr/bin/env bash
# Post-containment verification — NON-MUTATING by construction.
# Run any time (it also works as a standing security monitor).
# Every write-shaped probe targets a row id that cannot exist (all zeros),
# so zero rows can be affected; no INSERT is ever sent.
#
# Usage:
#   bash scripts/verify-containment.sh [expected-row-count|any] [mode]
#     expected-row-count  default 'any' = skip count assertion.
#                         An EXPLICIT number is an ASSERTION: mismatch FAILS
#                         (that is the point of passing it). Use it after any
#                         owner retirement step to prove exactly N rows remain.
#     mode                default = current world (anon SELECT open, RPCs live).
#                         'after-D' = Option D executed: anon SELECT must be
#                         DENIED (401/404) and row count usually 0.
# Exit 0 = all assertions passed; 1 = at least one FAILED.
set -u
B=https://hvjswsedoapsskedrkoj.supabase.co
K=sb_publishable_kY2tUdMKmqOIUPYi0OtfNg_K_YqpDSh
H1="apikey: $K"; H2="Authorization: Bearer $K"; CT="Content-Type: application/json"
GHOST=00000000-0000-0000-0000-000000000000
EXPECT=${1:-any}
MODE=${2:-current}
fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS $1 ($3)"; else echo "  FAIL $1 (expected $2, got $3)"; fail=1; fi
}

if [ "$MODE" = "after-D" ]; then
  echo "MODE after-D: anonymous access to spr_channels must be CLOSED"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$B/rest/v1/spr_channels?select=id&limit=1" -H "$H1" -H "$H2")
  case "$code" in
    401|403|404) echo "  PASS anon SELECT denied ($code)";;
    *) echo "  FAIL anon SELECT still open (HTTP $code — Option D not effective)"; fail=1;;
  esac
  for M in PATCH DELETE; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X $M "$B/rest/v1/spr_channels?id=eq.$GHOST" -H "$H1" -H "$H2" -H "$CT" -d '{"share_name":"x"}')
    case "$code" in
      401|403|404) echo "  PASS anon $M denied ($code)";;
      *) echo "  FAIL anon $M returned HTTP $code"; fail=1;;
    esac
  done
  echo "row count (after-D; readable rows should be 0)"
  rows=$(curl -s "$B/rest/v1/spr_channels?select=id&limit=200" -H "$H1" -H "$H2" | grep -o '"id"' | wc -l | tr -d ' ')
  echo "  rows now: $rows"
  if [ "$EXPECT" != "any" ] && [ "$rows" != "$EXPECT" ]; then echo "  FAIL row count $rows != expected $EXPECT"; fail=1
  else echo "  PASS row count (assertion: $EXPECT)"; fi
  if [ "$fail" = "0" ]; then echo "CONTAINMENT VERIFIED (after-D)"; else echo "CONTAINMENT CHECK FAILED"; fi
  exit $fail
fi

echo "1. anonymous SELECT stays available (share links depend on it)"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$B/rest/v1/spr_channels?select=id&limit=1" -H "$H1" -H "$H2")
  chk "GET spr_channels" 200 "$code"

echo "2. anonymous UPDATE still denied (nonexistent row = zero effect)"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$B/rest/v1/spr_channels?id=eq.$GHOST" -H "$H1" -H "$H2" -H "$CT" -d '{"share_name":"x"}')
  chk "PATCH (field-bearing, ghost row)" 401 "$code"

echo "3. anonymous DELETE still denied (nonexistent row = zero effect)"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$B/rest/v1/spr_channels?id=eq.$GHOST" -H "$H1" -H "$H2")
  chk "DELETE (ghost row)" 401 "$code"

echo "4. the RPCs EXIST and enforce (ghost ids -> typed errors, not 404)"
  code=$(curl -s -o /tmp/vcping.out -w '%{http_code}' -X POST "$B/rest/v1/rpc/spr_channel_ping" -H "$H1" -H "$H2" -H "$CT" -d "{\"p_id\":\"$GHOST\",\"p_token\":\"x\"}")
  chk "spr_channel_ping responds" 200 "$code"
  code=$(curl -s -o /tmp/vcw.out -w '%{http_code}' -X POST "$B/rest/v1/rpc/spr_channel_write" -H "$H1" -H "$H2" -H "$CT" -d "{\"p_id\":\"$GHOST\",\"p_token\":\"x\",\"p_payload\":\"x\",\"p_pushed_by\":\"v\",\"p_pushed_at\":\"v\",\"p_share_name\":\"v\"}")
  chk "spr_channel_write exists (400 channel-not-found)" 400 "$code"
  code=$(curl -s -o /tmp/vce.out -w '%{http_code}' -X POST "$B/rest/v1/rpc/spr_channel_enrol" -H "$H1" -H "$H2" -H "$CT" -d "{\"p_id\":\"$GHOST\",\"p_token\":\"x\",\"p_key\":\"x\"}")
  chk "spr_channel_enrol exists (400 channel-not-found)" 400 "$code"

echo "5. row count (assertion: $EXPECT)"
  rows=$(curl -s "$B/rest/v1/spr_channels?select=id&limit=200" -H "$H1" -H "$H2" | grep -o '"id"' | wc -l | tr -d ' ')
  echo "  rows now: $rows"
  if [ "$rows" -lt 1 ] && [ "$EXPECT" != "0" ]; then echo "  FAIL row count collapsed to 0 (table should not be empty in the current world; use 'after-D' mode after Option D)"; fail=1
  elif [ "$EXPECT" != "any" ] && [ "$rows" != "$EXPECT" ]; then echo "  FAIL row count $rows != expected $EXPECT"; fail=1
  else echo "  PASS row count"; fi

if [ "$fail" = "0" ]; then echo "CONTAINMENT VERIFIED"; else echo "CONTAINMENT CHECK FAILED"; fi
exit $fail
