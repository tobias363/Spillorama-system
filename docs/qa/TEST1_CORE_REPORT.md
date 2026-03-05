# TEST1 Core Correctness Report (Chat 1)

## Scope

Validerer kjerneflyt, spillregler og kontrakter:

1. Bonus-felter i claim/snapshot.
2. Runde-capping ved 30 trekk.
3. Launch token one-time og utlop.
4. Build/check-test for backend.

## Miljo

1. Branch: `codex/candy-test1-core-correctness`
2. Base: `codex/candy-c1-bonus-integration-step1`
3. Dato: 2026-03-05

## Automatiserte tester

Kommando:

```bash
bash scripts/qa/test1-core.sh
```

Resultat:

- [x] PASS (25/25 tester i testpakken).
- [x] `npm --prefix backend run test` PASS (42/42).
- [x] `npm --prefix backend run check` PASS.
- [x] `npm --prefix backend run build` PASS.

## Dekning mot hard gate

1. Portal `Spill naa` launch token resolve:
- Status: PARTIAL PASS (automatisk endpoint-smoke er implementert i script, men ble hoppet over uten runtime token i denne kjøringen).

2. Runde stopper ved 30 trekk:
- Status: PASS (dekket av `backend/src/game/BingoEngine.test.ts`).

3. Bonus deterministisk fra backend-claim:
- Status: PASS (dekket av `line claim includes deterministic backend bonus contract fields`).

4. Near-win blink korrekt:
- Status: PENDING (Unity runtime visuell test i chat 2).

5. `WINNING` inkl. bonus:
- Status: PARTIAL PASS (backend kontrakt + bonus payout-flyt verifisert, endelig UI-verifisering gjenstår i chat 2/3).

6. Ingen P0/P1 i logs under hel smoke:
- Status: PENDING (chat 3).

## Testcase-oppsummering (backend)

Relevant testfiler:

1. `backend/src/game/BingoEngine.test.ts`
2. `backend/src/launch/CandyLaunchTokenStore.test.ts`

Verifisert scenarier:

1. `MAX_DRAWS_REACHED` settes ved draw cap.
2. `winningPatternIndex`, `patternIndex`, `bonusTriggered`, `bonusAmount` i claim/snapshot.
3. Launch token er one-time.
4. Launch token utlop fungerer.
5. Blank launch token avvises.

## Kjoringslogg (sammendrag)

1. `bash scripts/qa/test1-core.sh`
- Typecheck: PASS
- Build: PASS
- Core tests: PASS (25/25)
- API contract smoke: SKIPPED (mangler `CANDY_API_BASE_URL` + `CANDY_TEST_ACCESS_TOKEN`)

2. `npm --prefix backend run test`
- PASS (42/42)

## Avvik / Oppfolging

1. API endpoint-kontrakt for `/api/games/candy/launch-token` og `/api/games/candy/launch-resolve` mot kjørende miljø må dokumenteres med faktisk respons (chat 3 kan supplere).
2. Unity parsing fallback ved manglende backend-felt må valideres med runtime-logg (chat 2/3).
