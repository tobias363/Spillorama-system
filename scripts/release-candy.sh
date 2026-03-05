#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_RELEASE_ENV_FILE="$ROOT_DIR/scripts/release.env"
RELEASE_ENV_FILE="${RELEASE_ENV_FILE:-$DEFAULT_RELEASE_ENV_FILE}"

if [[ -f "$RELEASE_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$RELEASE_ENV_FILE"
  set +a
  echo "[release-candy] Lastet env fra: $RELEASE_ENV_FILE"
fi

CHANNEL="${CANDY_RELEASE_CHANNEL:-staging}"
RELEASE_COMMIT="${CANDY_RELEASE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
RELEASE_VERSION="${CANDY_RELEASE_VERSION:-$(date -u +"%Y%m%d-%H%M%S")-$RELEASE_COMMIT}"
BUILD_DIR="${CANDY_WEBGL_OUTPUT_DIR:-"$ROOT_DIR/CandyBuilds/releases/$CHANNEL/$RELEASE_VERSION"}"
ARTIFACTS_DIR="${CANDY_ARTIFACTS_DIR:-"$ROOT_DIR/CandyBuilds/artifacts"}"
PUBLISH_MODE="${CANDY_PUBLISH_MODE:-none}" # none|local|rsync|s3
PROMOTE_LIVE="${CANDY_PROMOTE_LIVE:-false}"
BUILT_AT_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[release-candy] Mangler kommando: $cmd" >&2
    exit 1
  fi
}

write_checksums() {
  local target_dir="$1"
  local checksum_file="$2"
  local -a hasher_cmd

  if command -v sha256sum >/dev/null 2>&1; then
    hasher_cmd=(sha256sum)
  elif command -v shasum >/dev/null 2>&1; then
    hasher_cmd=(shasum -a 256)
  else
    echo "[release-candy] Mangler checksum-verktøy (sha256sum eller shasum)." >&2
    exit 1
  fi

  (
    cd "$target_dir"
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      "${hasher_cmd[@]}" "$file"
    done < <(
      find . -type f \
        ! -name "checksums.sha256" \
        ! -name "release-manifest.json" \
        | LC_ALL=C sort
    )
  ) >"$checksum_file"

  if [[ ! -s "$checksum_file" ]]; then
    echo "[release-candy] checksums.sha256 ble tom. Byggmappe mangler filer: $target_dir" >&2
    exit 1
  fi
}

publish_local() {
  local base_dir="${CANDY_PUBLISH_LOCAL_DIR:-}"
  if [[ -z "$base_dir" ]]; then
    echo "[release-candy] CANDY_PUBLISH_LOCAL_DIR mangler for local publish." >&2
    exit 1
  fi

  require_cmd rsync
  local version_target="$base_dir/$CHANNEL/releases/$RELEASE_VERSION"
  mkdir -p "$version_target"
  rsync -a --delete "$BUILD_DIR/" "$version_target/"
  echo "[release-candy] Publisert lokalt: $version_target"

  if is_true "$PROMOTE_LIVE"; then
    local live_target="$base_dir/$CHANNEL/current"
    local live_tmp="$base_dir/$CHANNEL/current.tmp-$RELEASE_VERSION"
    rm -rf "$live_tmp"
    mkdir -p "$live_tmp"
    rsync -a --delete "$BUILD_DIR/" "$live_tmp/"
    rm -rf "$live_target"
    mv "$live_tmp" "$live_target"
    echo "[release-candy] Oppdatert live alias: $live_target"
  fi
}

publish_rsync() {
  local target_template="${CANDY_PUBLISH_RSYNC_TARGET:-}"
  if [[ -z "$target_template" ]]; then
    echo "[release-candy] CANDY_PUBLISH_RSYNC_TARGET mangler for rsync publish." >&2
    exit 1
  fi

  require_cmd rsync
  local version_target="$target_template"
  version_target="${version_target//\{channel\}/$CHANNEL}"
  version_target="${version_target//\{release\}/$RELEASE_VERSION}"
  if [[ "$version_target" == "$target_template" ]]; then
    version_target="${target_template%/}/$CHANNEL/releases/$RELEASE_VERSION/"
  fi

  rsync -az --delete "$BUILD_DIR/" "$version_target"
  echo "[release-candy] Publisert via rsync: $version_target"

  if is_true "$PROMOTE_LIVE"; then
    local live_target="${CANDY_PUBLISH_RSYNC_LIVE_TARGET:-}"
    if [[ -n "$live_target" ]]; then
      rsync -az --delete "$BUILD_DIR/" "$live_target"
      echo "[release-candy] Oppdatert rsync live alias: $live_target"
    else
      echo "[release-candy] PROMOTE_LIVE=true, men CANDY_PUBLISH_RSYNC_LIVE_TARGET er ikke satt. Hopper over live alias."
    fi
  fi
}

publish_s3() {
  local bucket="${CANDY_PUBLISH_S3_BUCKET:-}"
  local prefix="${CANDY_PUBLISH_S3_PREFIX:-candy}"
  if [[ -z "$bucket" ]]; then
    echo "[release-candy] CANDY_PUBLISH_S3_BUCKET mangler for s3 publish." >&2
    exit 1
  fi

  require_cmd aws
  local version_key="s3://$bucket/$prefix/$CHANNEL/releases/$RELEASE_VERSION/"
  aws s3 sync "$BUILD_DIR/" "$version_key" --delete
  echo "[release-candy] Publisert til S3: $version_key"

  if is_true "$PROMOTE_LIVE"; then
    local live_key="s3://$bucket/$prefix/$CHANNEL/current/"
    aws s3 sync "$BUILD_DIR/" "$live_key" --delete
    echo "[release-candy] Oppdatert S3 live alias: $live_key"

    local cf_dist_id="${CANDY_CLOUDFRONT_DISTRIBUTION_ID:-}"
    if [[ -n "$cf_dist_id" ]]; then
      aws cloudfront create-invalidation \
        --distribution-id "$cf_dist_id" \
        --paths "/$prefix/$CHANNEL/current/*" "/$prefix/$CHANNEL/releases/$RELEASE_VERSION/*" >/dev/null
      echo "[release-candy] CloudFront invalidation trigget: $cf_dist_id"
    fi
  fi
}

echo "[release-candy] Channel: $CHANNEL"
echo "[release-candy] Release: $RELEASE_VERSION ($RELEASE_COMMIT)"
echo "[release-candy] Build dir: $BUILD_DIR"
echo "[release-candy] Publish mode: $PUBLISH_MODE"

export CANDY_RELEASE_CHANNEL="$CHANNEL"
export CANDY_RELEASE_VERSION="$RELEASE_VERSION"
export CANDY_RELEASE_COMMIT="$RELEASE_COMMIT"
export CANDY_WEBGL_OUTPUT_DIR="$BUILD_DIR"

bash "$ROOT_DIR/scripts/unity-webgl-build.sh"

mkdir -p "$ARTIFACTS_DIR"
CHECKSUM_FILE="$BUILD_DIR/checksums.sha256"
MANIFEST_FILE="$BUILD_DIR/release-manifest.json"
ZIP_FILE="$ARTIFACTS_DIR/CandyWebGL-$CHANNEL-$RELEASE_VERSION.zip"

write_checksums "$BUILD_DIR" "$CHECKSUM_FILE"

require_cmd zip
(
  cd "$BUILD_DIR"
  zip -qr "$ZIP_FILE" .
)

PROMOTE_LIVE_BOOL="false"
if is_true "$PROMOTE_LIVE"; then
  PROMOTE_LIVE_BOOL="true"
fi

cat >"$MANIFEST_FILE" <<EOF
{
  "channel": "$CHANNEL",
  "releaseVersion": "$RELEASE_VERSION",
  "commit": "$RELEASE_COMMIT",
  "builtAtUtc": "$BUILT_AT_UTC",
  "buildDirectory": "$BUILD_DIR",
  "zipArtifact": "$ZIP_FILE",
  "checksumFile": "$CHECKSUM_FILE",
  "publishMode": "$PUBLISH_MODE",
  "promoteLive": $PROMOTE_LIVE_BOOL
}
EOF

case "$PUBLISH_MODE" in
  none)
    echo "[release-candy] Publish hoppet over (mode=none)."
    ;;
  local)
    publish_local
    ;;
  rsync)
    publish_rsync
    ;;
  s3)
    publish_s3
    ;;
  *)
    echo "[release-candy] Ugyldig CANDY_PUBLISH_MODE: $PUBLISH_MODE (forventet: none|local|rsync|s3)" >&2
    exit 1
    ;;
esac

echo "[release-candy] Ferdig."
echo "[release-candy] Manifest: $MANIFEST_FILE"
echo "[release-candy] Zip: $ZIP_FILE"
