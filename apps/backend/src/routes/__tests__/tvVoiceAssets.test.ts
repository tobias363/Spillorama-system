/**
 * TV-voice asset router-tester.
 *
 * Dekker:
 *   - Gyldig voice + ball → 200 + audio/ogg + ikke-tom payload
 *   - Ugyldig voice (voice42) → 404
 *   - Ball utenfor [1, 75] → 404
 *   - Path-traversal i ball-param ("../foo") → 404
 *   - Ukjent ekstensjon (.wav) → 404
 *   - Manglende fil på disk → 404 (kjøres ved å peke projectDir på tom temp)
 *   - .mp3-forespørsel mappes til .ogg-fil og serveres med audio/ogg
 *
 * Bruker en ekte projectDir mot repo-roten i de fleste testene fordi voice-
 * filene faktisk eksisterer der; for negative-tester med manglende filer
 * lager vi en isolert temp-projectDir uten audio-katalog.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createTvVoiceAssetsRouter } from "../tvVoiceAssets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname her er apps/backend/src/routes/__tests__ → fire opp til repo-root.
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(projectDir: string): Promise<Harness> {
  const app = express();
  app.use(createTvVoiceAssetsRouter({ projectDir }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test("GET /tv-voices/voice1/1.mp3 returns ogg-bytes when game-client audio exists", async () => {
  const audioPath = path.resolve(
    REPO_ROOT,
    "packages/game-client/public/assets/game1/audio/no-male/1.ogg"
  );
  if (!fs.existsSync(audioPath)) {
    // Sanity: hopper hvis filen ikke er sjekket inn i denne sjekkouten.
    // (Skal være sjekket inn — testen feiler i CI hvis ikke.)
    throw new Error(`fixture missing: ${audioPath}`);
  }
  const ctx = await startServer(REPO_ROOT);
  try {
    const res = await fetch(`${ctx.baseUrl}/tv-voices/voice1/1.mp3`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/ogg");
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 100, `expected non-trivial payload, got ${buf.byteLength}`);
  } finally {
    await ctx.close();
  }
});

test("GET /tv-voices/voice2/75.ogg works (max ball, alt extension, female pack)", async () => {
  const audioPath = path.resolve(
    REPO_ROOT,
    "packages/game-client/public/assets/game1/audio/no-female/75.ogg"
  );
  if (!fs.existsSync(audioPath)) throw new Error(`fixture missing: ${audioPath}`);
  const ctx = await startServer(REPO_ROOT);
  try {
    const res = await fetch(`${ctx.baseUrl}/tv-voices/voice2/75.ogg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/ogg");
  } finally {
    await ctx.close();
  }
});

test("GET /tv-voices/voice3/42.mp3 maps to en/42.ogg", async () => {
  const audioPath = path.resolve(
    REPO_ROOT,
    "packages/game-client/public/assets/game1/audio/en/42.ogg"
  );
  if (!fs.existsSync(audioPath)) throw new Error(`fixture missing: ${audioPath}`);
  const ctx = await startServer(REPO_ROOT);
  try {
    const res = await fetch(`${ctx.baseUrl}/tv-voices/voice3/42.mp3`);
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("unknown voice-pack returns 404", async () => {
  const ctx = await startServer(REPO_ROOT);
  try {
    const res = await fetch(`${ctx.baseUrl}/tv-voices/voice42/1.mp3`);
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

test("ball out of range returns 404", async () => {
  const ctx = await startServer(REPO_ROOT);
  try {
    const tooHigh = await fetch(`${ctx.baseUrl}/tv-voices/voice1/76.mp3`);
    assert.equal(tooHigh.status, 404);
    const zero = await fetch(`${ctx.baseUrl}/tv-voices/voice1/0.mp3`);
    assert.equal(zero.status, 404);
    const negative = await fetch(`${ctx.baseUrl}/tv-voices/voice1/-1.mp3`);
    assert.equal(negative.status, 404);
  } finally {
    await ctx.close();
  }
});

test("non-numeric ball returns 404 (path-traversal guard)", async () => {
  const ctx = await startServer(REPO_ROOT);
  try {
    const traversal = await fetch(`${ctx.baseUrl}/tv-voices/voice1/..%2F..%2Fetc%2Fpasswd.mp3`);
    assert.equal(traversal.status, 404);
    const nonInt = await fetch(`${ctx.baseUrl}/tv-voices/voice1/3.14.mp3`);
    assert.equal(nonInt.status, 404);
    const alpha = await fetch(`${ctx.baseUrl}/tv-voices/voice1/abc.mp3`);
    assert.equal(alpha.status, 404);
  } finally {
    await ctx.close();
  }
});

test("disallowed extension returns 404", async () => {
  const ctx = await startServer(REPO_ROOT);
  try {
    const wav = await fetch(`${ctx.baseUrl}/tv-voices/voice1/1.wav`);
    assert.equal(wav.status, 404);
    const noExt = await fetch(`${ctx.baseUrl}/tv-voices/voice1/1`);
    assert.equal(noExt.status, 404);
  } finally {
    await ctx.close();
  }
});

test("missing audio-file on disk returns 404 (no game-client checkout)", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-voice-empty-"));
  try {
    const ctx = await startServer(tempDir);
    try {
      const res = await fetch(`${ctx.baseUrl}/tv-voices/voice1/1.mp3`);
      assert.equal(res.status, 404);
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
