# Candy Hard Gate (Lokal-First)

## Mål
Ingen push før Candy har passert lokal hard-gate.

## Kjøring
```bash
bash scripts/qa/candy-hard-gate.sh
```

## Standard (default)
1. Verifiserer at kun `Theme1` er aktiv build-scene.
2. Kjører backend typecheck (`npm --prefix backend run check`).
3. Kjører backend tester (`npm --prefix backend run test`).
4. Kjører Unity compile-check (`scripts/unity-compile-check.sh`).

## Valgfrie steg
- Skru av Unity compile-check (hvis editor er åpen):
```bash
CANDY_GATE_RUN_UNITY_COMPILE=false bash scripts/qa/candy-hard-gate.sh
```

- Kjør også E2E smoke mot backend:
```bash
CANDY_GATE_RUN_E2E=true \
CANDY_API_BASE_URL=https://bingosystem-3.onrender.com \
CANDY_ADMIN_EMAIL=<admin-email> \
CANDY_ADMIN_PASSWORD=<admin-passord> \
CANDY_TEST_ACCESS_TOKEN=<player-token> \
bash scripts/qa/candy-hard-gate.sh
```

## Pass-kriterier
1. Ingen compile/typecheck-feil.
2. Ingen feilede backend-tester.
3. (Ved E2E) full runde uten kritisk kontraktbrudd.
4. Klar for push til staging-branch.

## Arbeidsregel
1. Endre lokalt.
2. Test i Unity.
3. Kjør hard-gate script.
4. Push.
5. Manuell deploy via GitHub Actions.
