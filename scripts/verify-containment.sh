#!/usr/bin/env bash
# Post-containment verification — NON-MUTATING by construction.
# Run AFTER the owner has executed docs/supabase-write-token.sql STEP 1.
# Every write-shaped probe targets a row id that cannot exist (all zeros),
# so zero rows can be affected; no INSERT is ever sent.
# Usage: bash scripts/verify-containment.sh
B=https://hvjswsedoapsskedrkoj.supabase.co
K=sb_publishable_kY2tUdMKmqOIUPYi0OtfNg_K_YqpDSh
H1="apikey: $K"; H2="Authorization: Bearer $K"; CT="Content-Type: application/json"
GHOST=00000000-0000-0000-0000-000000000000
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS $1 ($3)"; else echo "  FAIL $1 (expected $2, got $3)"; fail=1; fi
}
echo "1. anonymous SELECT stays available (share links depend on it)"
check "GET spr_channels" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$B/rest/v1/spr_channels?select=id&limit=1" -H "$H1" -H "$H2")"
echo "2. anonymous UPDATE still denied (nonexistent row = zero effect)"
check "PATCH (field-bearing, ghost row)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$B/rest/v1/spr_channels?id=eq.$GHOST" -H "$H1" -H "$H2" -H "$CT" -d '{"share_name":"verify-no-row"}')"
echo "3. anonymous DELETE still denied (nonexistent row = zero effect)"
check "DELETE (ghost row)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$B/rest/v1/spr_channels?id=eq.$GHOST" -H "$H1" -H "$H2")"
echo "4. the RPCs now EXIST (ping must answer, not 404)"
code=$(curl -s -o /tmp/vcping.out -w '%{http_code}' -X POST "$B/rest/v1/rpc/spr_channel_ping" -H "$H1" -H "$H2" -H "$CT" -d "{\"p_id\":\"$GHOST\",\"p_token\":\"x\"}")
if [ "$code" = "200" ]; then echo "  PASS spr_channel_ping responds ($code: $(cat /tmp/vcping.out))"; else echo "  FAIL spr_channel_ping (expected 200, got $code: $(cat /tmp/vcping.out))"; fail=1; fi
echo "5. row count unchanged (must equal the pre-change count)"
rows=$(curl -s "$B/rest/v1/spr_channels?select=id&limit=200" -H "$H1" -H "$H2" | grep -o '"id"' | wc -l | tr -d ' ')
echo "  rows now: $rows (expected: the same as before the change; 88 as of 2026-11-14)"
if [ "$rows" -lt 1 ]; then echo "  FAIL row count collapsed"; fail=1; else echo "  PASS rows present"; fi
echo
[ "$fail" = "0" ] && echo "CONTAINMENT VERIFIED" || echo "CONTAINMENT INCOMPLETE — send this output back"
exit $fail
