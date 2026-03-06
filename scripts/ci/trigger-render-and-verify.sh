#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOOK_URL="${RENDER_CANDYGAME_DEPLOY_HOOK_URL:-}"
HEALTH_URL="${CANDYGAME_HEALTHCHECK_URL:-https://candygame-9q3h.onrender.com/}"
RELEASE_JSON_URL="${CANDYGAME_RELEASE_JSON_URL:-https://candygame-9q3h.onrender.com/release.json}"
WAIT_TIMEOUT_SECONDS="${CANDYGAME_DEPLOY_WAIT_TIMEOUT_SECONDS:-900}"
POLL_INTERVAL_SECONDS="${CANDYGAME_DEPLOY_POLL_INTERVAL_SECONDS:-10}"
EXPECTED_RELEASE_COMMIT_RAW="${EXPECTED_RELEASE_COMMIT:-}"
EXPECTED_RELEASE_VERSION="${EXPECTED_RELEASE_VERSION:-}"

if [[ -z "${DEPLOY_HOOK_URL}" ]]; then
  echo "[candygame-render] Missing RENDER_CANDYGAME_DEPLOY_HOOK_URL." >&2
  exit 1
fi
if [[ -z "${EXPECTED_RELEASE_COMMIT_RAW}" ]]; then
  echo "[candygame-render] Missing EXPECTED_RELEASE_COMMIT." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[candygame-render] jq is required." >&2
  exit 1
fi

expected_release_commit="$(printf '%s' "${EXPECTED_RELEASE_COMMIT_RAW}" | tr '[:upper:]' '[:lower:]')"
expected_release_commit="${expected_release_commit:0:8}"

echo "[candygame-render] Trigger deploy hook"
curl -fsS --retry 3 --retry-all-errors --connect-timeout 10 -X POST "${DEPLOY_HOOK_URL}" >/dev/null

echo "[candygame-render] Waiting for health: ${HEALTH_URL}"
start_ts="$(date +%s)"

while true; do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    echo "[candygame-render] Healthcheck OK"
    break
  fi

  now_ts="$(date +%s)"
  elapsed="$((now_ts - start_ts))"
  if (( elapsed >= WAIT_TIMEOUT_SECONDS )); then
    echo "[candygame-render] Timeout after ${WAIT_TIMEOUT_SECONDS}s waiting for healthcheck." >&2
    exit 1
  fi

  sleep "${POLL_INTERVAL_SECONDS}"
done

echo "[candygame-render] Verifying live release fingerprint: ${RELEASE_JSON_URL}"
while true; do
  release_json="$(curl -fsS "${RELEASE_JSON_URL}")"
  live_release_version="$(printf '%s' "${release_json}" | jq -r '.releaseVersion // empty')"
  live_release_commit="$(printf '%s' "${release_json}" | jq -r '.releaseCommit // empty')"

  if [[ -z "${live_release_version}" || -z "${live_release_commit}" ]]; then
    echo "[candygame-render] release.json missing releaseVersion/releaseCommit, waiting..."
  else
    live_release_commit="$(printf '%s' "${live_release_commit}" | tr '[:upper:]' '[:lower:]')"
    live_release_commit="${live_release_commit:0:8}"

    if [[ "${live_release_commit}" == "${expected_release_commit}" ]]; then
      if [[ -n "${EXPECTED_RELEASE_VERSION}" && "${live_release_version}" != "${EXPECTED_RELEASE_VERSION}" ]]; then
        echo "[candygame-render] releaseCommit matches, waiting for releaseVersion update. expected=${EXPECTED_RELEASE_VERSION} actual=${live_release_version}"
      else
        break
      fi
    else
      echo "[candygame-render] releaseCommit not updated yet. expected=${expected_release_commit} actual=${live_release_commit}"
    fi
  fi

  now_ts="$(date +%s)"
  elapsed="$((now_ts - start_ts))"
  if (( elapsed >= WAIT_TIMEOUT_SECONDS )); then
    echo "[candygame-render] Timeout after ${WAIT_TIMEOUT_SECONDS}s waiting for release.json to match expected commit." >&2
    exit 1
  fi

  sleep "${POLL_INTERVAL_SECONDS}"
done

echo "[candygame-render] releaseVersion=${live_release_version}"
echo "[candygame-render] releaseCommit=${live_release_commit}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "release_version=${live_release_version}"
    echo "release_commit=${live_release_commit}"
  } >>"${GITHUB_OUTPUT}"
fi
