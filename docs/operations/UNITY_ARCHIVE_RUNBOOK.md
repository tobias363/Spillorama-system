# Unity archive runbook (BIN-532, scope-endret 2026-04-17)

**Owner:** Technical lead (Tobias Haugen)
**Linear:** [BIN-532](https://linear.app/bingosystem/issue/BIN-532) (closed with new scope — not reopened)
**Related:** [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) (BIN-540 per-hall flag) · [`PILOT_CUTOVER_RUNBOOK.md`](./PILOT_CUTOVER_RUNBOOK.md) §3 · [`../compliance/RELEASE_GATE.md`](../compliance/RELEASE_GATE.md) §7

## Why an archive, not a CI job

Unity is permanently decommissioned as part of the web migration. The originally-planned BIN-532 approach (GitHub Actions rebuild on every tag + weekly cron + Unity Pro license) was over-engineered for a code-freeze artefact that never changes. The replacement is a one-time local build, uploaded read-only to the CDN, served at a fixed versioned path.

Trade-off recorded for posterity:

| Dimension | Old plan (CI rebuilds) | New plan (read-only archive) |
| --- | --- | --- |
| Ongoing cost | GameCI minutes + `UNITY_LICENSE` seat | zero (one-time bandwidth) |
| Rebuild capacity | any commit on demand | none — archive is frozen |
| Secret surface | `UNITY_LICENSE` / `UNITY_EMAIL` / `UNITY_PASSWORD` / `UNITY_SERIAL` in repo secrets | none |
| Rollback latency | build (~5–25 min) → deploy | flag flip → next reload |
| Acceptable because | Unity was a live product | Unity is an archive artefact during the pilot window only |

If a Unity hotfix is ever genuinely required (contrary to the current plan), the Unity source lives at `legacy/unity-client/` and can be built locally on the technical lead's machine without touching CI. The archive path stays stable — a rebuild would just upload the new WebGL output at the same `/legacy-unity-archive/v1.0.0/` path (or a `vN.N.N+1` suffix with a coordinated flag flip).

---

## 1. One-time upload — what the technical lead does

Performed by the technical lead with an existing Unity editor install at the current prod tag:

1. Check out `legacy/unity-client/` at the prod tag being archived. Record the commit SHA.
2. Open the project in Unity 6000.3.10f1 (pinned in `legacy/unity-client/ProjectSettings/ProjectVersion.txt`).
3. Build target: **WebGL**. Output directory: `build/WebGL/`.
4. After the build, verify bundle size is in the expected 35–80 MB compressed range. If it's dramatically smaller, LFS didn't resolve — abort and rerun after `git lfs pull`.
5. Stamp a `BUILD_METADATA.txt` file inside `build/WebGL/` with:
   ```
   unityVersion=6000.3.10f1
   commitSha=<full 40-char SHA>
   archivedAt=<ISO timestamp, UTC>
   archivedBy=<operator name>
   archivePath=/legacy-unity-archive/v1.0.0/
   ```
6. Upload the `build/WebGL/` contents to the CDN at `/legacy-unity-archive/v1.0.0/`. Paths inside the folder are preserved. Exact upload command depends on CDN:
   - **Render static site:** commit the bundle as a deploy-PR to the static-site repo, merge, Render auto-deploys. Preferred — change is reviewable.
   - **Cloudflare R2 / direct bucket:** `rclone sync build/WebGL/ <remote>:<bucket>/legacy-unity-archive/v1.0.0/ --immutable --no-update-modtime`. The `--immutable` flag must set the bucket to block subsequent writes at the versioned path.
7. Set a `Cache-Control: public, max-age=31536000, immutable` header for the entire `/legacy-unity-archive/v1.0.0/*` tree. The archive never changes — caching is safe and desirable.
8. Post the archive URL + commit SHA + upload timestamp to [BIN-532 Linear](https://linear.app/bingosystem/issue/BIN-532) and to `PILOT_CUTOVER_RUNBOOK.md` §7 as the first-row evidence.

Expected output:

```
<cdn>/legacy-unity-archive/v1.0.0/
  ├── index.html
  ├── Build/
  │     ├── *.wasm
  │     ├── *.data
  │     ├── *.framework.js
  │     └── *.loader.js
  ├── TemplateData/
  └── BUILD_METADATA.txt
```

---

## 2. Verifying the archive (any operator, anytime)

Quick probe:

```bash
curl -I <cdn>/legacy-unity-archive/v1.0.0/index.html
# expect HTTP/1.1 200
# expect Cache-Control: public, max-age=31536000, immutable
# expect Content-Type: text/html
```

Metadata check:

```bash
curl -s <cdn>/legacy-unity-archive/v1.0.0/BUILD_METADATA.txt
# expect unityVersion=6000.3.10f1
# expect commitSha=<matches the prod tag from step 1>
# expect archivePath=/legacy-unity-archive/v1.0.0/
```

Full loader sanity (every 30 days, or whenever the CDN provider changes):

1. Open `<cdn>/legacy-unity-archive/v1.0.0/?hall=STAGING_HALL_1&token=<staging-token>` in a browser with devtools open.
2. Confirm the Unity loader reports "ready" in the console within 15 s on a warm cache (< 60 s cold).
3. Close the tab. No traffic should go to any backend endpoint other than the socket handshake the Unity client normally makes.

---

## 3. Rollback: how a hall falls back to the archive

This is the operator-facing path from [`PILOT_CUTOVER_RUNBOOK.md`](./PILOT_CUTOVER_RUNBOOK.md) §3. Summary here so ops doesn't have to jump files in the middle of an incident:

1. Admin-web → Halls → select hall → *Client variant* → `unity` → Save. Per BIN-540, the backend's `/api/halls/:slug/client-variant` endpoint now returns `unity`; the web-shell next-session-load routes the hall to the archive URL.
2. Purge the CDN cache for the hall's variant-lookup endpoint (`/api/halls/<slug>/client-variant`). The archive itself is immutable and does not need purging.
3. Tell the hall-admin to refresh the TV-skjerm and ask players to close-and-reopen the app.
4. Next session lands on the archived Unity bundle. Expected load time on a warm CDN: < 15 s. Cold: < 60 s.

Rollback-of-rollback (if the archive itself is broken, which would be a long-dormant CDN / provider-level incident): flip the hall back to `web`, page the technical lead, and run §2 full-loader sanity from a fresh connection to confirm the archive is actually the failure point.

---

## 4. What changed from the original BIN-532 scope

Original plan (pre-2026-04-17): `.github/workflows/unity-build.yml` triggered by `workflow_dispatch` + tag pushes + weekly cron, consuming GameCI + `UNITY_LICENSE` secret, producing a 90-day-retained artefact per commit.

**Removed in this scope change:**

- `.github/workflows/unity-build.yml` — deleted.
- `UNITY_LICENSE`, `UNITY_EMAIL`, `UNITY_PASSWORD`, `UNITY_SERIAL` repo secrets — not provisioned. Can be removed from any `.env.example` / `README` references.
- Weekly cron build — not needed; archive is static.

**Preserved:**

- `legacy/unity-client/` source in the repo. Deletion happens at project DoD (Fase 5 per `PILOT_CUTOVER_RUNBOOK.md` §6), not before — the source is the audit trail for the archived build.
- `ProjectVersion.txt` pin — informational only now, still used by anyone rebuilding locally.
- `BIN-532` Linear issue kept closed with the new scope. Not reopened — the original ticket is about "Unity build reproducibility", which the archive satisfies by existing at a known SHA at a known path.

**Ops impact:**

- Pre-pilot checklist in `RELEASE_GATE.md` §7 updated: Unity-row now reads "Unity archive available on CDN" and checks archive URL returns 200, not CI run URL.
- `PILOT_CUTOVER_RUNBOOK.md` §1 pre-flight: no longer asks for `UNITY_LICENSE` in GitHub Actions.
- `PILOT_CUTOVER_RUNBOOK.md` §3 rollback: flips the flag to plain `unity` (archive), not `unity-fallback` (which was a BIN-540 distinction for "currently-rebuilding from CI"). `unity-fallback` as a flag value remains supported by the backend for belt-and-braces — it simply resolves to the same archive.
- Rehearsal step 1 in `PILOT_CUTOVER_RUNBOOK.md` §5 / Task 3 of bolk 8: archive-access verification (`curl -I` probe above) instead of triggering a CI workflow.

---

## 5. Archive versioning — if a second archive is ever needed

Convention for any future replacement:

- Path: `/legacy-unity-archive/vN.N.N/` — always a stable version suffix, never `latest/`.
- `BUILD_METADATA.txt` always included.
- Old archives stay at their paths (cost of CDN storage is negligible); the flag flip is how operators select which one a hall serves. Currently the backend routes all `client_variant = unity` halls to `v1.0.0/` via a hardcoded constant in the web-shell; if multi-version becomes a real need, promote that constant to a per-hall column.

This is not expected to happen — the archive is a rollback insurance policy, not a living artefact.
