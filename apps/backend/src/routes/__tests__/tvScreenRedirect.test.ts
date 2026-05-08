/**
 * TV-skjerm-redirect: `/tv/<hallId>/<tvToken>[/winners]` →
 * `/admin/#/tv/<hallId>/<tvToken>[/winners]`.
 *
 * Tobias-feedback 2026-05-08: TV-skjerm vise svart skjerm + MIME-feil
 * fordi player-shellen ble servert på TV-pathen og lastet relative
 * asset-paths (spillvett.css osv.). Fix: redirect bare TV-paths til
 * admin-Vite-bundlen som faktisk har TV-side-koden bak hash-routeren.
 *
 * Vi tester redirecten isolert ved å registrere samme regex-route i en
 * frisk express-app. Speiler nøyaktig handlingen i `index.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

const TV_REDIRECT_PATTERN =
  /^\/tv\/([^/?#]+)\/([^/?#]+)(\/winners)?\/?$/;

function buildApp(): express.Express {
  const app = express();
  app.get(TV_REDIRECT_PATTERN, (req, res) => {
    const match = TV_REDIRECT_PATTERN.exec(req.path);
    if (!match) {
      res.status(404).send("not found");
      return;
    }
    const hallId = encodeURIComponent(match[1] ?? "");
    const tvToken = encodeURIComponent(match[2] ?? "");
    const winners = match[3] ? "/winners" : "";
    res.redirect(302, `/admin/#/tv/${hallId}/${tvToken}${winners}`);
  });
  // Catch-all så ingen-match-tester kan skille redirect-treff fra fallthrough.
  app.use((_req, res) => {
    res.status(404).send("fallthrough");
  });
  return app;
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

async function start(): Promise<Ctx> {
  const server = buildApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

test("tv-redirect: /tv/<hall>/<token> → /admin/#/tv/<hall>/<token>", async () => {
  const ctx = await start();
  try {
    const res = await fetch(
      `${ctx.baseUrl}/tv/demo-hall-001/11111111-1111-4111-8111-111111111111`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      "/admin/#/tv/demo-hall-001/11111111-1111-4111-8111-111111111111"
    );
  } finally {
    await ctx.close();
  }
});

test("tv-redirect: /tv/<hall>/<token>/winners bevarer winners-suffikset", async () => {
  const ctx = await start();
  try {
    const res = await fetch(
      `${ctx.baseUrl}/tv/demo-hall-001/abc/winners`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      "/admin/#/tv/demo-hall-001/abc/winners"
    );
  } finally {
    await ctx.close();
  }
});

test("tv-redirect: /tv/<hall>/<token>/ tolerer trailing slash", async () => {
  const ctx = await start();
  try {
    const res = await fetch(
      `${ctx.baseUrl}/tv/demo-hall-001/abc/`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      "/admin/#/tv/demo-hall-001/abc"
    );
  } finally {
    await ctx.close();
  }
});

test("tv-redirect: UUID-format token redirects med UUID intakt", async () => {
  const ctx = await start();
  try {
    // Realistisk test: hallId = slug, tvToken = UUID. Dette er det
    // faktiske formatet i prod (app_halls.tv_token = UUID).
    const res = await fetch(
      `${ctx.baseUrl}/tv/demo-hall-003/33333333-3333-4333-8333-333333333333`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      "/admin/#/tv/demo-hall-003/33333333-3333-4333-8333-333333333333"
    );
  } finally {
    await ctx.close();
  }
});

test("tv-redirect: feil path-form passerer gjennom (fallthrough)", async () => {
  const ctx = await start();
  try {
    // Bare ett segment etter /tv/ → matcher ikke regex → 404 fallthrough
    const res = await fetch(`${ctx.baseUrl}/tv/only-one-segment`, {
      redirect: "manual",
    });
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "fallthrough");
  } finally {
    await ctx.close();
  }
});

test("tv-redirect: ekstra path-segment (utover winners) passerer gjennom", async () => {
  const ctx = await start();
  try {
    const res = await fetch(
      `${ctx.baseUrl}/tv/hall/token/something-else`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "fallthrough");
  } finally {
    await ctx.close();
  }
});
