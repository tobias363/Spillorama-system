/**
 * TV-voice audio asset router — serverer ball-utrop til hall-TV-en.
 *
 * Wireframe PDF 14 + README i `apps/backend/public/tv-voices/`. TV-klienten
 * (`apps/admin-web/src/pages/tv/TVScreenPage.ts`) henter
 * `/tv-voices/<voice>/<ball>.mp3` (eller `.ogg`) når en ny ball trekkes.
 *
 * Voice-pack-ene voice1/voice2/voice3 mapper til de eksisterende Game 1
 * audio-pakkene som ligger i `packages/game-client/public/assets/game1/audio/`.
 * Vi serverer derfra direkte for å unngå å duplisere ~7.7 MB lydfiler i
 * backend/public — én sannhet, og enhver re-recording av tellertall slår
 * automatisk gjennom til TV-en. Render-deployen bygger hele monorepo-et,
 * så `packages/`-stien er tilgjengelig ved runtime.
 *
 * Mapping (kan justeres uten å endre TV-klient eller migration-data):
 *   voice1 → no-male   (norsk mannsstemme)
 *   voice2 → no-female (norsk kvinnestemme)
 *   voice3 → en        (engelsk)
 *
 * Files er `.ogg` per i dag (Game 1 har historisk brukt OGG Vorbis i Unity-
 * eksporten). Chrome/kiosk-nettleseren støtter både `.mp3` og `.ogg` via
 * HTMLAudioElement, så vi serverer `.ogg`-bytene under begge endelser slik at
 * eksisterende TV-klient (som spør `.mp3`) fortsetter å fungere uten endring.
 *
 * Override-flyt: Hvis det legges en eksplisitt fil under
 * `apps/backend/public/tv-voices/<voice>/<ball>.<ext>` så vinner den over
 * fallback-en (express.static-mounten plukker den opp før denne routeren).
 * Dette gir oss en utvei hvis noen voice-pakker skal byttes uten å røre
 * game-client.
 */

import express from "express";
import path from "node:path";
import fs from "node:fs";

const VOICE_DIR_BY_PACK: Record<string, string> = {
  voice1: "no-male",
  voice2: "no-female",
  voice3: "en",
};

const ALLOWED_EXT = new Set([".mp3", ".ogg"]);
const MAX_BALL = 75;

export interface TvVoiceAssetsRouterDeps {
  /**
   * Repo-rot — `apps/backend/dist/index.js` runner med
   * `path.resolve(__dirname, "../..")`. Brukes for å finne
   * `packages/game-client/public/assets/game1/audio/`.
   */
  projectDir: string;
}

/**
 * Bygger en express-router som håndterer `GET /tv-voices/:voice/:ball.:ext`.
 *
 * Returnerer 404 ved:
 *   - Ukjent voice-pack
 *   - Ball-nummer utenfor [1, 75]
 *   - Ekstensjon ikke i { mp3, ogg }
 *   - Manglende fil på disk
 *
 * Returnerer 200 + audio-bytes ellers, med Cache-Control for å la kiosk-
 * nettleseren cache permanent (filene er immutable per voice/ball).
 */
export function createTvVoiceAssetsRouter(deps: TvVoiceAssetsRouterDeps): express.Router {
  const router = express.Router();
  const audioRoot = path.resolve(
    deps.projectDir,
    "packages/game-client/public/assets/game1/audio"
  );

  router.get("/tv-voices/:voice/:filename", (req, res) => {
    const voice = String(req.params.voice ?? "");
    const filename = String(req.params.filename ?? "");
    const ext = path.extname(filename).toLowerCase();
    const base = path.basename(filename, ext);

    if (!ALLOWED_EXT.has(ext)) {
      res.status(404).end();
      return;
    }

    const ballNum = Number.parseInt(base, 10);
    if (
      !Number.isFinite(ballNum) ||
      String(ballNum) !== base ||
      ballNum < 1 ||
      ballNum > MAX_BALL
    ) {
      res.status(404).end();
      return;
    }

    const packDir = VOICE_DIR_BY_PACK[voice];
    if (!packDir) {
      res.status(404).end();
      return;
    }

    // Filene er fysisk lagret som .ogg. Hvis klienten spør om .mp3 servert vi
    // .ogg-bytene under riktig content-type — Web Audio API i Chrome leser
    // headers, ikke endelse, så avspilling fungerer.
    const oggPath = path.join(audioRoot, packDir, `${ballNum}.ogg`);
    if (!fs.existsSync(oggPath)) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(oggPath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).end();
      }
    });
  });

  return router;
}
