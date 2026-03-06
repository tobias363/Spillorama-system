# Candy Baseline Freeze (2026-03-06)

## Formål
Dette dokumentet fryser referansetilstanden for Candy før opprydding/stabilisering, slik at vi kan verifisere at endringer faktisk treffer riktig kodevei.

## Git baseline
- Branch: `codex/candy-stabilization-hard-gate`
- Baseline commit: `d970dfa6`

## Unity scene baseline
- Aktiv build-scene: `Assets/Scenes/Theme1.unity`
- SHA256 `Theme1.unity`: `17ed5640c80bde16e29646956f59f86527fb77566bcfbba041f3aed5966d1480`

## Script baseline (SHA256)
- `Candy/Assets/Script/APIManager.cs`
  - `4dfc3a6ba8efcac5adac8d1810d662e110aa30df0cd96bbcec158b2002807383`
- `Candy/Assets/Script/APIManager.RealtimeState.cs`
  - `bed18cd07d767b174b860a87fd6a525efe1c06a83b243103f85fd05ca31af49f`
- `Candy/Assets/Script/APIManager.RealtimePlayFlow.cs`
  - `666ab17bb3b0b2e2f45f489166c4f458729f81d981e43d83d555b74b2be87bf1`
- `Candy/Assets/Script/NumberGenerator.cs`
  - `f5f1a2ac182c2e63ea0f551f60d6a8dcb9e8f8ffff87df5724e6b19e133a37db`
- `Candy/Assets/Script/UIManager.cs`
  - `0709317ef937182d3aa1f548244245566f4e62f528e9dee9f7eb832d07950765`
- `Candy/Assets/Script/BallManager.cs`
  - `79a9462294d2d3d1a54834d72012a235e23f20a9056c99e7c21bb5dc1b7fa207`

## Live WebGL fingerprint (før opprydding)
- Endpoint: `https://candygame-9q3h.onrender.com/release.json`
- `releaseVersion`: `20260306-100852-af962638`
- `releaseCommit`: `af962638`

## Known risk i baseline
1. Dobbelt launch-bootstrap i klient (`CandyLaunchBootstrap` + gammel resolve-flyt i `APIManager`).
2. Runtime auto-oppretting av kritiske komponenter skjuler manglende scene-bindinger.
3. Legacy fallback kan maskere at realtime-flyt egentlig feiler i editor.
4. Overlappende ansvar mellom `APIManager` og legacy flyt (`NumberGenerator`/`EventManager`).
