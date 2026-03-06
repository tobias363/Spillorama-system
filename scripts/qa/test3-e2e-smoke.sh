#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CANDY_API_BASE_URL:-}" ]]; then
  echo "[test3-e2e] Missing CANDY_API_BASE_URL"
  exit 1
fi

if [[ -z "${CANDY_ADMIN_EMAIL:-}" || -z "${CANDY_ADMIN_PASSWORD:-}" ]]; then
  echo "[test3-e2e] Missing CANDY_ADMIN_EMAIL or CANDY_ADMIN_PASSWORD"
  exit 1
fi

BASE_URL="${CANDY_API_BASE_URL%/}"
STALL_TIMEOUT_SECONDS="${CANDY_STALL_TIMEOUT_SECONDS:-45}"
RUN_TIMEOUT_SECONDS="${CANDY_RUN_TIMEOUT_SECONDS:-120}"
POLL_SECONDS="${CANDY_SMOKE_POLL_SECONDS:-2}"
MAX_ROUND_ATTEMPTS="${CANDY_SMOKE_MAX_ROUND_ATTEMPTS:-5}"
ARTIFACT_DIR="${CANDY_SMOKE_ARTIFACT_DIR:-$(mktemp -d)}"
mkdir -p "${ARTIFACT_DIR}"

HTTP_BODY=""
HTTP_CODE=""

http_request() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local auth_header="${4:-}"

  local response
  local -a curl_args
  curl_args=(-sS -w $'\n%{http_code}' -X "$method" "$url" -H "Content-Type: application/json")
  if [[ -n "$auth_header" ]]; then
    curl_args+=(-H "$auth_header")
  fi
  if [[ -n "$payload" ]]; then
    curl_args+=(-d "$payload")
  fi
  response="$(curl "${curl_args[@]}")"

  HTTP_BODY="${response%$'\n'*}"
  HTTP_CODE="${response##*$'\n'}"
}

write_artifact() {
  local filename="$1"
  local content="$2"
  printf '%s\n' "$content" >"${ARTIFACT_DIR}/${filename}"
}

append_artifact_line() {
  local filename="$1"
  local content="$2"
  printf '%s\n' "$content" >>"${ARTIFACT_DIR}/${filename}"
}

assert_http_json_ok() {
  local context="$1"
  local expected_code="${2:-}"

  if [[ -n "$expected_code" && "$HTTP_CODE" != "$expected_code" ]]; then
    echo "[test3-e2e] ${context} expected HTTP ${expected_code}, got ${HTTP_CODE}" >&2
    echo "[test3-e2e] Body: ${HTTP_BODY}" >&2
    exit 1
  fi

  if ! jq -e . >/dev/null 2>&1 <<<"${HTTP_BODY}"; then
    echo "[test3-e2e] ${context} returned non-JSON body" >&2
    echo "[test3-e2e] Body: ${HTTP_BODY}" >&2
    exit 1
  fi

  local ok
  ok="$(jq -r '.ok // false' <<<"${HTTP_BODY}")"
  if [[ "$ok" != "true" ]]; then
    echo "[test3-e2e] ${context} returned ok=false" >&2
    echo "[test3-e2e] Body: ${HTTP_BODY}" >&2
    exit 1
  fi
}

resolve_player_token() {
  if [[ -n "${CANDY_TEST_ACCESS_TOKEN:-}" ]]; then
    printf '%s' "${CANDY_TEST_ACCESS_TOKEN}"
    return 0
  fi

  if [[ -n "${CANDY_TEST_EMAIL:-}" && -n "${CANDY_TEST_PASSWORD:-}" ]]; then
    local login_payload
    login_payload="$(jq -n --arg email "${CANDY_TEST_EMAIL}" --arg password "${CANDY_TEST_PASSWORD}" '{email:$email,password:$password}')"
    http_request "POST" "${BASE_URL}/api/auth/login" "${login_payload}"
    assert_http_json_ok "user login" "200"
    write_artifact "user-login.json" "${HTTP_BODY}"

    local token
    token="$(jq -r '.data.accessToken // empty' <<<"${HTTP_BODY}")"
    if [[ -n "$token" ]]; then
      printf '%s' "$token"
      return 0
    fi
  fi

  echo "[test3-e2e] Missing player auth. Set CANDY_TEST_ACCESS_TOKEN or CANDY_TEST_EMAIL+CANDY_TEST_PASSWORD" >&2
  exit 1
}

admin_login() {
  local payload
  payload="$(jq -n --arg email "${CANDY_ADMIN_EMAIL}" --arg password "${CANDY_ADMIN_PASSWORD}" '{email:$email,password:$password}')"
  http_request "POST" "${BASE_URL}/api/admin/auth/login" "$payload"
  assert_http_json_ok "admin login" "200"
  write_artifact "admin-login.json" "${HTTP_BODY}"

  local token
  token="$(jq -r '.data.accessToken // empty' <<<"${HTTP_BODY}")"
  if [[ -z "$token" ]]; then
    echo "[test3-e2e] admin login missing accessToken" >&2
    exit 1
  fi
  printf '%s' "$token"
}

create_and_run_round_probe() {
  local admin_auth_header="$1"
  local attempt="$2"

  http_request "GET" "${BASE_URL}/api/admin/halls" "" "${admin_auth_header}"
  assert_http_json_ok "admin halls" "200"

  local hall_id
  hall_id="$(jq -r '.data[] | select((.isActive // true) == true) | .id' <<<"${HTTP_BODY}" | head -n 1)"
  if [[ -z "$hall_id" ]]; then
    hall_id="$(jq -r '.data[0].id // empty' <<<"${HTTP_BODY}")"
  fi
  if [[ -z "$hall_id" ]]; then
    echo "[test3-e2e] No hall available for admin room create" >&2
    exit 1
  fi

  local create_payload
  create_payload="$(jq -n --arg hallId "$hall_id" '{hallId:$hallId}')"
  http_request "POST" "${BASE_URL}/api/admin/rooms" "$create_payload" "${admin_auth_header}"
  assert_http_json_ok "admin room create" "200"
  write_artifact "round-attempt-${attempt}-room-create.json" "${HTTP_BODY}"

  local room_code host_player_id
  room_code="$(jq -r '.data.roomCode // empty' <<<"${HTTP_BODY}")"
  host_player_id="$(jq -r '.data.playerId // empty' <<<"${HTTP_BODY}")"
  if [[ -z "$room_code" || -z "$host_player_id" ]]; then
    echo "[test3-e2e] room create missing roomCode/playerId" >&2
    exit 1
  fi

  local arm_payload
  arm_payload="$(jq -n --arg playerId "$host_player_id" '{playerId:$playerId,armed:true}')"
  http_request "POST" "${BASE_URL}/api/admin/rooms/${room_code}/bet-arm" "$arm_payload" "${admin_auth_header}"
  assert_http_json_ok "admin bet-arm" "200"
  write_artifact "round-attempt-${attempt}-bet-arm.json" "${HTTP_BODY}"

  local started=0
  local stall_deadline=$((SECONDS + STALL_TIMEOUT_SECONDS))
  local last_next_start_at=""
  local next_start_changed=0
  : >"${ARTIFACT_DIR}/round-attempt-${attempt}-scheduler-polls.jsonl"

  while (( SECONDS < stall_deadline )); do
    http_request "GET" "${BASE_URL}/api/admin/rooms/${room_code}" "" "${admin_auth_header}"
    assert_http_json_ok "admin room snapshot (wait for running)" "200"

    local poll_line
    poll_line="$(jq -c '{
      at: (now | todate),
      roomCode: .data.code,
      status: (.data.currentGame.status // "NONE"),
      nextStartAt: (.data.scheduler.nextStartAt // null),
      armedPlayerCount: (.data.scheduler.armedPlayerCount // null),
      minPlayers: (.data.scheduler.minPlayers // null),
      schedulerEnabled: (.data.scheduler.enabled // null)
    }' <<<"${HTTP_BODY}")"
    append_artifact_line "round-attempt-${attempt}-scheduler-polls.jsonl" "${poll_line}"

    local status next_start_at
    status="$(jq -r '.data.currentGame.status // "NONE"' <<<"${HTTP_BODY}")"
    next_start_at="$(jq -r '.data.scheduler.nextStartAt // ""' <<<"${HTTP_BODY}")"

    if [[ "$status" == "RUNNING" ]]; then
      started=1
      break
    fi

    if [[ -n "$next_start_at" && "$next_start_at" != "$last_next_start_at" ]]; then
      next_start_changed=1
      last_next_start_at="$next_start_at"
    fi

    sleep "$POLL_SECONDS"
  done

  if [[ "$started" != "1" ]]; then
    if [[ "$next_start_changed" != "1" ]]; then
      echo "[test3-e2e] FAIL stall: status stayed waiting >${STALL_TIMEOUT_SECONDS}s without nextStartAt changes (room=${room_code})." >&2
    else
      echo "[test3-e2e] FAIL: room did not transition to RUNNING within ${STALL_TIMEOUT_SECONDS}s (room=${room_code})." >&2
    fi
    return 2
  fi

  local run_deadline=$((SECONDS + RUN_TIMEOUT_SECONDS))
  local has_claim_pattern_fields=0
  local has_bonus_fields_when_triggered=1
  : >"${ARTIFACT_DIR}/round-attempt-${attempt}-running-polls.jsonl"

  while (( SECONDS < run_deadline )); do
    http_request "GET" "${BASE_URL}/api/admin/rooms/${room_code}" "" "${admin_auth_header}"
    assert_http_json_ok "admin room snapshot (running loop)" "200"

    local run_poll_line
    run_poll_line="$(jq -c '{
      at: (now | todate),
      roomCode: .data.code,
      status: (.data.currentGame.status // "NONE"),
      drawnCount: ((.data.currentGame.drawnNumbers // []) | length),
      endedReason: (.data.currentGame.endedReason // null),
      claimCount: ((.data.currentGame.claims // []) | length),
      nextStartAt: (.data.scheduler.nextStartAt // null)
    }' <<<"${HTTP_BODY}")"
    append_artifact_line "round-attempt-${attempt}-running-polls.jsonl" "${run_poll_line}"

    local status draw_count
    status="$(jq -r '.data.currentGame.status // "NONE"' <<<"${HTTP_BODY}")"
    draw_count="$(jq -r '(.data.currentGame.drawnNumbers // []) | length' <<<"${HTTP_BODY}")"

    if [[ "$status" == "RUNNING" ]]; then
      local claim_payload
      claim_payload="$(jq -n --arg playerId "$host_player_id" '{playerId:$playerId,type:"LINE"}')"
      http_request "POST" "${BASE_URL}/api/admin/rooms/${room_code}/claim" "$claim_payload" "${admin_auth_header}"
      if [[ "$HTTP_CODE" == "200" ]]; then
        local claim_line
        claim_line="$(jq -c --arg playerId "$host_player_id" '{
          at: (now | todate),
          roomCode: (.data.roomCode // empty),
          playerId: $playerId,
          claims: ((.data.snapshot.currentGame.claims // []) | map(select(.playerId == $playerId)))
        }' <<<"${HTTP_BODY}")"
        append_artifact_line "round-attempt-${attempt}-claim-events.jsonl" "${claim_line}"

        local found_pattern
        found_pattern="$(jq -r --arg playerId "$host_player_id" '(
          .data.snapshot.currentGame.claims // []
        ) | any(.playerId == $playerId and .valid == true and (.winningPatternIndex != null) and (.patternIndex != null) and (.winningPatternIndex == .patternIndex))' <<<"${HTTP_BODY}")"
        if [[ "$found_pattern" == "true" ]]; then
          has_claim_pattern_fields=1
        fi

        local bonus_ok
        bonus_ok="$(jq -r --arg playerId "$host_player_id" '(
          .data.snapshot.currentGame.claims // []
        ) | all(
          if .playerId == $playerId and (.bonusTriggered // false) == true
          then (.bonusAmount != null)
          else true
          end
        )' <<<"${HTTP_BODY}")"
        if [[ "$bonus_ok" != "true" ]]; then
          has_bonus_fields_when_triggered=0
        fi
      fi
    fi

    if [[ "$status" == "ENDED" ]]; then
      local ended_reason
      ended_reason="$(jq -r '.data.currentGame.endedReason // ""' <<<"${HTTP_BODY}")"
      local ended_draw_count
      ended_draw_count="$(jq -r '(.data.currentGame.drawnNumbers // []) | length' <<<"${HTTP_BODY}")"

      write_artifact "round-attempt-${attempt}-ended-snapshot.json" "${HTTP_BODY}"

      if [[ "$ended_reason" != "MAX_DRAWS_REACHED" ]]; then
        echo "[test3-e2e] FAIL: endedReason=${ended_reason}, expected MAX_DRAWS_REACHED (room=${room_code})." >&2
        return 3
      fi
      if [[ "$ended_draw_count" != "30" ]]; then
        echo "[test3-e2e] FAIL: draw count=${ended_draw_count}, expected 30 (room=${room_code})." >&2
        return 4
      fi
      if [[ "$has_bonus_fields_when_triggered" != "1" ]]; then
        echo "[test3-e2e] FAIL: bonusTriggered claim missing bonusAmount for player ${host_player_id}." >&2
        return 5
      fi

      if [[ "$has_claim_pattern_fields" == "1" ]]; then
        echo "[test3-e2e] Round ${attempt}: verified claim fields for winning pattern in room ${room_code}."
        return 0
      fi

      echo "[test3-e2e] Round ${attempt}: no valid LINE claim with pattern fields yet (room ${room_code}), retrying on new room."
      return 10
    fi

    sleep "$POLL_SECONDS"
  done

  echo "[test3-e2e] FAIL: running round timeout after ${RUN_TIMEOUT_SECONDS}s (room=${room_code})." >&2
  return 6
}

echo "[test3-e2e] Artifacts: ${ARTIFACT_DIR}"

echo "[test3-e2e] Health check"
http_request "GET" "${BASE_URL}/health"
assert_http_json_ok "health" "200"
write_artifact "health.json" "${HTTP_BODY}"

echo "[test3-e2e] Resolve player token"
player_access_token="$(resolve_player_token)"
player_auth_header="Authorization: Bearer ${player_access_token}"

echo "[test3-e2e] Launch token issue"
http_request "POST" "${BASE_URL}/api/games/candy/launch-token" "{}" "${player_auth_header}"
assert_http_json_ok "launch-token" "200"
write_artifact "launch-token.json" "${HTTP_BODY}"

launch_token="$(jq -r '.data.launchToken // empty' <<<"${HTTP_BODY}")"
if [[ -z "${launch_token}" ]]; then
  echo "[test3-e2e] launch-token response missing launchToken" >&2
  exit 1
fi

echo "[test3-e2e] Launch resolve (first consume)"
http_request "POST" "${BASE_URL}/api/games/candy/launch-resolve" "$(jq -n --arg launchToken "$launch_token" '{launchToken:$launchToken}')"
assert_http_json_ok "launch-resolve-first" "200"
write_artifact "launch-resolve-first.json" "${HTTP_BODY}"

if ! jq -e '.data.accessToken and .data.hallId and .data.walletId' >/dev/null 2>&1 <<<"${HTTP_BODY}"; then
  echo "[test3-e2e] launch-resolve-first missing expected identity payload" >&2
  exit 1
fi

echo "[test3-e2e] Launch resolve (second consume should fail)"
http_request "POST" "${BASE_URL}/api/games/candy/launch-resolve" "$(jq -n --arg launchToken "$launch_token" '{launchToken:$launchToken}')"
if [[ "$HTTP_CODE" != "400" && "$HTTP_CODE" != "200" ]]; then
  echo "[test3-e2e] launch-resolve-second expected HTTP 400/200, got ${HTTP_CODE}" >&2
  exit 1
fi
write_artifact "launch-resolve-second.json" "${HTTP_BODY}"

if ! jq -e '.ok == false and .error.code == "INVALID_LAUNCH_TOKEN"' >/dev/null 2>&1 <<<"${HTTP_BODY}"; then
  echo "[test3-e2e] launch-resolve-second did not return INVALID_LAUNCH_TOKEN" >&2
  echo "[test3-e2e] Body: ${HTTP_BODY}" >&2
  exit 1
fi

echo "[test3-e2e] Admin login + drift settings check"
admin_access_token="$(admin_login)"
admin_auth_header="Authorization: Bearer ${admin_access_token}"

http_request "GET" "${BASE_URL}/api/admin/candy-mania/settings" "" "${admin_auth_header}"
assert_http_json_ok "admin candy settings" "200"
write_artifact "admin-candy-settings.json" "${HTTP_BODY}"

if [[ "$(jq -r '.data.autoRoundStartIntervalMs // -1' <<<"${HTTP_BODY}")" != "30000" ]]; then
  echo "[test3-e2e] Expected autoRoundStartIntervalMs=30000 before smoke run." >&2
  exit 1
fi
if [[ "$(jq -r '.data.autoRoundStartEnabled // false' <<<"${HTTP_BODY}")" != "true" ]]; then
  echo "[test3-e2e] Expected autoRoundStartEnabled=true before smoke run." >&2
  exit 1
fi
if [[ "$(jq -r '.data.autoDrawEnabled // false' <<<"${HTTP_BODY}")" != "true" ]]; then
  echo "[test3-e2e] Expected autoDrawEnabled=true before smoke run." >&2
  exit 1
fi

round_passed=0
for attempt in $(seq 1 "$MAX_ROUND_ATTEMPTS"); do
  echo "[test3-e2e] Round attempt ${attempt}/${MAX_ROUND_ATTEMPTS}"
  if create_and_run_round_probe "$admin_auth_header" "$attempt"; then
    round_passed=1
    break
  else
    rc=$?
    if [[ "$rc" != "10" ]]; then
      echo "[test3-e2e] Round attempt ${attempt} failed with code ${rc}." >&2
      exit "$rc"
    fi
  fi
done

if [[ "$round_passed" != "1" ]]; then
  echo "[test3-e2e] FAIL: could not verify claim pattern fields after ${MAX_ROUND_ATTEMPTS} rounds." >&2
  exit 7
fi

echo "[test3-e2e] PASS"
echo "[test3-e2e] Artifacts stored in ${ARTIFACT_DIR}"
