# Pilot Hardware Specs

Dette dokumentet beskriver hvilken hardware vi emulerer i testmiljø for å
fange blink- og paint-storm-regresjoner som ikke viser seg på utvikler-
MacBook-er, men gjør det på faktiske pilot-terminaler.

## Teknobingo pilot-terminaler (faktisk)

> [!WARNING]
> Feltene under er **ikke verifisert** per 2026-04-24. Tobias bekrefter og
> fyller inn eksakte specs før pilot-start. Inntil da bruker vi den
> konservative emulerings-profilen under "Test-profil".

- **CPU:** [TODO: Tobias — f.eks. Intel Celeron J4125, Pentium Silver, Core i3-8100T]
- **GPU:** [TODO: Tobias — integrert Intel UHD 600/605 eller lignende]
- **RAM:** [TODO: Tobias — typisk 4-8 GB DDR4]
- **Display:** [TODO: Tobias — 1920x1080 60Hz forventet, men 4K-kiosk mulig]
- **OS:** [TODO: Tobias — Windows 10/11 LTSC eller Linux kiosk]
- **Browser:** [TODO: Tobias — Chromium-versjon som kjører på terminalen]
- **Terminal-type:** [TODO: Tobias — bingoagent-PC vs TV-skjerm-kiosk vs spillernes tablet]

## Test-profil (simulert)

Se `scripts/pilot-hardware/profile.json`. Konservativ emulering:

| Attributt | Verdi | Begrunnelse |
| --- | --- | --- |
| CPU throttle | 4x slower enn dev-maskin | Tilsvarer ca 4-5 år gammel mini-PC vs 2024-MacBook |
| GPU acceleration | Disabled (software rasterizer) | Emulerer integrert GPU uten WebGL-throughput |
| Viewport | 1920x1080 @ dpr 1 | Standard bingohall-terminal |
| Monitor refresh | 60Hz | Pilot-terminaler er ikke 120Hz+ |
| Network | Fast 3G | Defensivt — dekker evt svakt WiFi i bingohall |

CPU-throttle er konservativt satt. Reelt hardware kan være enda svakere,
spesielt hvis det kjører mye Chrome-ekstensjoner eller har aktiv AV-scan.
**Vi anbefaler aktuell hardware-test også før GA.**

### Hvorfor separate baselines?

Pilot-hw-baselines bruker strengere terskler (ca 30-50% strammere enn
dev-baseline) fordi:

1. **Lavere FPS-headroom.** 60Hz monitor + 4x CPU throttle gir ~65 rAF-
   calls/sec maks, mens dev-MacBook kan håndtere 130+ uten merkbart hakk.
2. **backdrop-filter er kostbart på integrated GPU.** Hver blurred overlay
   koster flere millisekunder per frame — grensen på 2 (vs 3 i dev)
   reflekterer dette.
3. **Paint-stormer oppleves visuelt på svak GPU.** 20 paints/2s på pilot-
   hw vs 30 på dev.

## Oppdatering

Når Tobias har bekreftet faktisk pilot-hardware:

1. Oppdater specs-tabellen over med faktiske verdier.
2. Juster `scripts/pilot-hardware/profile.json` hvis nødvendig
   (spesielt `cpuThrottleRate` og `chromiumArgs`).
3. Bump `version`-feltet i profile.json (semver patch).
4. Re-generate `baseline-pilot-hw.json` mot oppdatert profil:
   ```bash
   npm run perf:collect:pilot-hw
   # Inspiser report-pilot-hw.json, juster baseline manuelt med ca
   # 10-20% headroom over observert verdi, commit
   ```
5. Sync baseline.profileVersion med profile.version.
6. `npm run pilot-hw:validate` for å bekrefte konsistens.
7. Dokumentér endringen i en PR med "test-profile bump"-prefix.

## Relatert

- `scripts/pilot-hardware/profile.json` — profile config
- `scripts/pilot-hardware/baseline-pilot-hw.json` — budget-terskler
- `.github/workflows/pilot-hardware-test.yml` — CI-gate
- PR #468 — backdrop-filter-regresjon som motiverte dette sporet
- PR #469 — performance-budget CI-gate (dev-baseline)
- PR #470 — Playwright visual regression (dev-baseline)

## Åpne spørsmål

Kommentert i PR. Ber PM besvare:

1. **Hvilken hardware kjører pilot-terminalene?** Uten eksakte specs er
   profilen et kvalifisert gjett. Risiko: vi godkjenner kode som blinker
   på faktisk hardware.
2. **Har vi tilgang til én faktisk terminal for ekte testing?** Simulering
   dekker ikke alle GPU-driver-quirks. Én fysisk terminal på dev-benken
   ville la oss validere profilen.
3. **Skal vi også teste på 4K-kiosk-oppsett (TV-skjerm bak bingohall)?**
   4K@60Hz med svak GPU er en annen profil — dobbel pikselmengde
   forsterker paint-storm-kostnad. Kan være verdt en egen `pilot-4k`-profil.
