# TEST3 E2E/Ops Report (Chat 3)

## Scope

1. End-to-end flyt i staging/prod-like:
   auth -> launch -> room -> game:start -> draw -> claim -> round end
2. Admin settings-validering (`launchUrl`, `apiBaseUrl`, settings JSON).
3. Feilhåndtering med forståelige meldinger.
4. Deploy + rollback verifikasjon.

## Miljo

1. Branch: `codex/candy-test3-e2e-ops`
2. Deploy target: `https://bingosystem-3.onrender.com`
3. Dato: `2026-03-05`
4. Tester:
- `bash scripts/qa/test3-e2e-smoke.sh` (med env)
- `bash scripts/qa/test3-e2e-smoke.sh` (uten env)
- `curl /api/admin/games` med PLAYER-token
- `npm --prefix backend run check`
- `npm --prefix backend run build`

## E2E scenarier

1. Happy path:
- Status: `FAIL` (target mangler Candy launch-endepunkter)
- Bevis:
  - `CANDY_API_BASE_URL=https://bingosystem-3.onrender.com CANDY_TEST_ACCESS_TOKEN=<token> bash scripts/qa/test3-e2e-smoke.sh`
  - Output: `launch-token expected HTTP 200, got 404` + `Cannot POST /api/games/candy/launch-token`

2. Utløpt launch token:
- Status: `BLOCKED` (samme 404-blokkering før token kan utstedes)
- Bevis:
  - `/api/games/candy/launch-token` finnes ikke på deploy target.
  - Scriptet verifiserer fortsatt one-time consume når endpointet er tilgjengelig.

3. Ugyldig launch token:
- Status: `FAIL` (endpoint mangler på deploy target)
- Bevis:
  - `curl -X POST https://bingosystem-3.onrender.com/api/games/candy/launch-resolve ...`
  - Output: `Cannot POST /api/games/candy/launch-resolve`

4. Manglende env:
- Status: `PASS`
- Bevis:
  - Uten `CANDY_API_BASE_URL`: `[test3-e2e] Missing CANDY_API_BASE_URL`
  - Uten `CANDY_TEST_ACCESS_TOKEN`: `[test3-e2e] Missing CANDY_TEST_ACCESS_TOKEN`

5. Uautorisert admin-kall:
- Status: `PASS`
- Bevis:
  - `GET /api/admin/games` med PLAYER-token returnerer:
  - `{"ok":false,"error":{"code":"FORBIDDEN","message":"Du har ikke tilgang til dette endepunktet."}}`
  - `POST /api/admin/auth/login` med PLAYER-bruker returnerer:
  - `{"ok":false,"error":{"code":"FORBIDDEN","message":"Kun ADMIN-brukere kan logge inn i admin-panelet."}}`

6. Admin-validering av `launchUrl` / `apiBaseUrl`:
- Status: `PARTIAL` (runtime write-test blokkert uten ADMIN-token)
- Bevis:
  - Valideringskoder finnes i runtime: `INVALID_CANDY_LAUNCH_URL` / `INVALID_CANDY_API_BASE_URL` i `backend/src/index.ts`.
  - Validering brukes i admin settings-flow via `normalizeGameSettingsForUpdate(...)` -> `readCandyLaunchSettings(...)`.

## Deploy smoke

1. Build:
- Status: `PASS` (`npm --prefix backend run check`, `npm --prefix backend run build`)

2. Runtime health:
- Status: `PASS` (`GET /health` returnerer `{"ok":true,...}`)

3. Spillflyt etter deploy:
- Status: `FAIL` (Candy launch-token flyt kan ikke startes pga manglende endpoints på target)

## Rollback smoke

1. Rollback utført:
- Status: `BLOCKED` (ingen deploy-/rollback-tilgang i dette miljøet)

2. Health etter rollback:
- Status: `BLOCKED`

3. Spillflyt etter rollback:
- Status: `BLOCKED`

## Kritiske logg-funn

1. Deploy target svarer 404/HTML for `POST /api/games/candy/launch-token`.
2. Deploy target svarer 404/HTML for `POST /api/games/candy/launch-resolve`.

## Oppdateringer i rollout plan

Oppdaterte seksjoner i `docs/CANDY_RELEASE_ROLLOUT_PLAN.md`:

1. Ny preflight-gate: verifiser Candy launch-endepunkter med HTTP 200 før full smoke.
2. Presisert rollback-eierskap (Render rollback + post-rollback health + launch smoke).

## Konklusjon

- [ ] PASS
- [x] FAIL
