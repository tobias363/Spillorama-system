#!/usr/bin/env bash
set -euo pipefail

: "${CANDY_BUILD_DIR:?CANDY_BUILD_DIR is required}"
: "${EXPECTED_RELEASE_COMMIT:?EXPECTED_RELEASE_COMMIT is required}"
: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${UNITY_EMAIL:?UNITY_EMAIL is required}"
: "${UNITY_PASSWORD:?UNITY_PASSWORD is required}"

PROJECT_PATH="${PROJECT_PATH:-Candy}"
PROJECT_VERSION_FILE="${PROJECT_PATH}/ProjectSettings/ProjectVersion.txt"

if [[ ! -f "${PROJECT_VERSION_FILE}" ]]; then
  echo "[build-candy-webgl] Missing ${PROJECT_VERSION_FILE}" >&2
  exit 1
fi

UNITY_VERSION="$(sed -n 's/^m_EditorVersion:[[:space:]]*//p' "${PROJECT_VERSION_FILE}" | head -n 1)"
if [[ -z "${UNITY_VERSION}" ]]; then
  echo "[build-candy-webgl] Failed to read Unity version from ${PROJECT_VERSION_FILE}" >&2
  exit 1
fi

IMAGE="unityci/editor:ubuntu-${UNITY_VERSION}-webgl-3"

echo "[build-candy-webgl] Using Unity ${UNITY_VERSION}"
echo "[build-candy-webgl] Pulling image ${IMAGE}"
docker pull "${IMAGE}"

mkdir -p "${CANDY_BUILD_DIR}"

docker run --rm \
  --workdir /github/workspace \
  --env UNITY_EMAIL \
  --env UNITY_PASSWORD \
  --env CANDY_BUILD_DIR \
  --env RELEASE_VERSION \
  --env EXPECTED_RELEASE_COMMIT \
  --volume "${PWD}:/github/workspace" \
  --entrypoint /bin/bash \
  "${IMAGE}" -lc '
set -euo pipefail

mkdir -p /tmp/BlankProject/Assets

echo "[build-candy-webgl] Activating Unity account entitlement"
unity-editor \
  -batchmode \
  -nographics \
  -quit \
  -logFile /dev/stdout \
  -username "${UNITY_EMAIL}" \
  -password "${UNITY_PASSWORD}" \
  -projectPath /tmp/BlankProject

echo "[build-candy-webgl] Building Candy WebGL"
unity-editor \
  -batchmode \
  -nographics \
  -quit \
  -logFile /dev/stdout \
  -projectPath /github/workspace/Candy \
  -buildTarget WebGL \
  -executeMethod WebGLBuild.BuildWebGLFromCommandLine \
  -customBuildPath "${CANDY_BUILD_DIR}" \
  -releaseVersion "${RELEASE_VERSION}" \
  -releaseCommit "${EXPECTED_RELEASE_COMMIT}"
'

echo "[build-candy-webgl] Build completed"
