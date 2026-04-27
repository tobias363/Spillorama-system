/**
 * GAP #5: integrasjonstester for /api/players/me/profile/image.
 *
 * Dekker validering (size/MIME/dimensions), kategorier, audit-log-
 * sideeffekter og auth-gating.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPlayerProfileImageRouter } from "../playerProfileImage.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";
import { InMemoryImageStorageAdapter } from "../../media/ImageStorageService.js";

function makeUser(overrides: Partial<PublicAppUser> = {}): PublicAppUser {
  return {
    id: "user-alice",
    email: "alice@test.no",
    displayName: "Alice",
    walletId: "wallet-alice",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 1000,
    profileImageUrl: null,
    bankidSelfieUrl: null,
    bankidDocumentUrl: null,
    ...overrides,
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    updates: Array<{ userId: string; category: string; imageUrl: string | null }>;
    storage: InMemoryImageStorageAdapter;
    auditStore: InMemoryAuditLogStore;
  };
  close: () => Promise<void>;
}

async function startServer(user: PublicAppUser): Promise<Ctx> {
  const updates: Ctx["spies"]["updates"] = [];
  const storage = new InMemoryImageStorageAdapter();
  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token !== "alice-token") throw new DomainError("UNAUTHORIZED", "bad token");
      return user;
    },
    async updateProfileImage(input: {
      userId: string;
      category: "profile" | "bankid_selfie" | "bankid_document";
      imageUrl: string | null;
    }): Promise<PublicAppUser> {
      updates.push({ userId: input.userId, category: input.category, imageUrl: input.imageUrl });
      const updated = { ...user };
      if (input.category === "profile") updated.profileImageUrl = input.imageUrl;
      if (input.category === "bankid_selfie") updated.bankidSelfieUrl = input.imageUrl;
      if (input.category === "bankid_document") updated.bankidDocumentUrl = input.imageUrl;
      return updated;
    },
  } as unknown as PlatformService;

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const app = express();
  // Tillat større JSON-payloads for base64-bilder.
  app.use(express.json({ limit: "10mb" }));
  app.use(
    createPlayerProfileImageRouter({
      platformService,
      auditLogService,
      imageStorage: storage,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { updates, storage, auditStore },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(url: string, method: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAuditEvent(
  store: InMemoryAuditLogStore,
  actionPrefix: string,
  timeoutMs = 500
): Promise<PersistedAuditEvent | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const events = await store.list();
    const hit = events.find((e) => e.action.startsWith(actionPrefix));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Image fixtures ──────────────────────────────────────────────────────────
//
// Vi bygger minimum-valid PNG/JPEG/WEBP-bilder for å trigge
// magic-byte-detektering og dimensjons-parsing uten å laste inn en faktisk
// image-encoder.

/**
 * Minimum-valid 200x200 PNG. PNG-strukturen vi trenger:
 *   - 8-byte signatur
 *   - IHDR chunk: length(4) + "IHDR"(4) + width(4) + height(4) + bit-depth(1)
 *     + color-type(1) + compression(1) + filter(1) + interlace(1) + crc(4)
 *
 * Resten kan være junk fordi `validateImageBase64` bare leser headeren.
 */
function makePngBytes(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = Buffer.alloc(25);
  ihdrChunk.writeUInt32BE(13, 0);                  // length = 13
  ihdrChunk.write("IHDR", 4, "ascii");
  ihdrChunk.writeUInt32BE(width, 8);
  ihdrChunk.writeUInt32BE(height, 12);
  ihdrChunk.writeUInt8(8, 16);                     // bit depth
  ihdrChunk.writeUInt8(2, 17);                     // color type RGB
  ihdrChunk.writeUInt8(0, 18);                     // compression
  ihdrChunk.writeUInt8(0, 19);                     // filter
  ihdrChunk.writeUInt8(0, 20);                     // interlace
  // CRC vi gir blanks; validatoren sjekker ikke CRC.
  return Buffer.concat([sig, ihdrChunk]);
}

/**
 * Minimum-valid JPEG (200x200). Bygger SOI + APP0-segment + SOF0-marker
 * for at dimensjons-parser skal finne treff.
 */
function makeJpegBytes(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  // APP0 / JFIF (16-byte segment) — vi gir nok til at iterator-en hopper
  // korrekt videre uten å parse innholdet.
  const app0 = Buffer.alloc(2 + 16);
  app0.writeUInt8(0xff, 0);
  app0.writeUInt8(0xe0, 1);
  app0.writeUInt16BE(16, 2);             // segment-length
  app0.write("JFIF", 4, "ascii");
  // SOF0-segment: marker + length(8) + precision(1) + height(2) + width(2) + comps(1) + comp(3*3=9? we'll only need precision+H+W).
  // We write a 11-byte segment so iterator skips correctly.
  const sof0 = Buffer.alloc(2 + 11);
  sof0.writeUInt8(0xff, 0);
  sof0.writeUInt8(0xc0, 1);
  sof0.writeUInt16BE(11, 2);             // segment-length
  sof0.writeUInt8(8, 4);                 // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(3, 9);                 // num components
  // resten kan være 0 (komponentbeskrivelser).
  return Buffer.concat([soi, app0, sof0]);
}

function makeWebpBytes(width: number, height: number): Buffer {
  // VP8X-chunk strukturen:
  //   "RIFF" + filesize(4) + "WEBP" + "VP8X" + chunkSize(4) + flags(4) +
  //   width-1(3) + height-1(3) (LE)
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);              // filesize (placeholder)
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUInt32LE(10, 16);             // chunk-size
  // flags 4 bytes (0)
  // width-1 (24-bit LE)
  const wMinus = width - 1;
  buf[24] = wMinus & 0xff;
  buf[25] = (wMinus >> 8) & 0xff;
  buf[26] = (wMinus >> 16) & 0xff;
  const hMinus = height - 1;
  buf[27] = hMinus & 0xff;
  buf[28] = (hMinus >> 8) & 0xff;
  buf[29] = (hMinus >> 16) & 0xff;
  return buf;
}

function bytesToBase64(b: Buffer): string {
  return b.toString("base64");
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("GAP #5: POST profile/image med kategori=profile lagrer URL og logger audit", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      {
        imageBase64: bytesToBase64(makePngBytes(200, 200)),
        mimeType: "image/png",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.category, "profile");
    assert.equal(res.json.data.mimeType, "image/png");
    assert.equal(res.json.data.width, 200);
    assert.equal(res.json.data.height, 200);
    assert.equal(ctx.spies.updates.length, 1);
    assert.equal(ctx.spies.updates[0]!.category, "profile");
    assert.match(ctx.spies.updates[0]!.imageUrl ?? "", /\/uploads\/profile-images\//);
    assert.equal(ctx.spies.storage.stored.length, 1);

    const event = await waitForAuditEvent(ctx.spies.auditStore, "player.profile.image.upload");
    assert.ok(event, "forventet audit-event for profile-image-upload");
    assert.equal(event!.actorId, "user-alice");
    assert.equal(event!.actorType, "PLAYER");
    assert.equal((event!.details as { category: string }).category, "profile");
    assert.equal((event!.details as { isBankid: boolean }).isBankid, false);
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med kategori=bankid_selfie logger på bankid.image.upload-prefiks", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=bankid_selfie`,
      "POST",
      "alice-token",
      {
        imageBase64: bytesToBase64(makeJpegBytes(300, 300)),
        mimeType: "image/jpeg",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.category, "bankid_selfie");
    const event = await waitForAuditEvent(ctx.spies.auditStore, "bankid.image.upload");
    assert.ok(event, "forventet bankid.image.upload-audit");
    assert.equal(event!.action, "bankid.image.upload.selfie");
    assert.equal((event!.details as { isBankid: boolean }).isBankid, true);
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med kategori=bankid_document logger på bankid.image.upload-prefiks", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=bankid_document`,
      "POST",
      "alice-token",
      {
        imageBase64: bytesToBase64(makeWebpBytes(500, 500)),
        mimeType: "image/webp",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.category, "bankid_document");
    assert.equal(res.json.data.mimeType, "image/webp");
    assert.equal(res.json.data.width, 500);
    const event = await waitForAuditEvent(ctx.spies.auditStore, "bankid.image.upload");
    assert.ok(event);
    assert.equal(event!.action, "bankid.image.upload.document");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST uten Authorization gir UNAUTHORIZED (400)", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      undefined,
      { imageBase64: bytesToBase64(makePngBytes(200, 200)) }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med ugyldig kategori returnerer INVALID_INPUT", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=hacker`,
      "POST",
      "alice-token",
      { imageBase64: bytesToBase64(makePngBytes(200, 200)) }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med PDF-bytes (ikke gyldig image) avvises med IMAGE_INVALID_FORMAT", async () => {
  const ctx = await startServer(makeUser());
  try {
    // PDF starter med "%PDF-1." — ikke en av våre godkjente formater.
    const pdfBytes = Buffer.from("%PDF-1.4\n%fake-pdf-content\n", "utf-8");
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      { imageBase64: pdfBytes.toString("base64") }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "IMAGE_INVALID_FORMAT");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med for små dimensjoner avvises", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      { imageBase64: bytesToBase64(makePngBytes(50, 50)) }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "IMAGE_TOO_SMALL");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med for store dimensjoner avvises", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      { imageBase64: bytesToBase64(makePngBytes(5000, 5000)) }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "IMAGE_TOO_LARGE_DIMENSIONS");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med for stor file (>5MB) avvises", async () => {
  const ctx = await startServer(makeUser());
  try {
    // Lag en gyldig PNG-header + 6MB padding.
    const header = makePngBytes(200, 200);
    const padding = Buffer.alloc(6 * 1024 * 1024, 0);
    const big = Buffer.concat([header, padding]);
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      { imageBase64: big.toString("base64") }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "IMAGE_TOO_LARGE");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: POST med tomt imageBase64 avvises", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      { imageBase64: "" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #5: DELETE setter URL=null på riktig kolonne og audit-logger", async () => {
  const ctx = await startServer(
    makeUser({ profileImageUrl: "/uploads/profile-images/old.png" })
  );
  try {
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "DELETE",
      "alice-token"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.url, null);
    assert.equal(ctx.spies.updates.length, 1);
    assert.equal(ctx.spies.updates[0]!.imageUrl, null);
    const event = await waitForAuditEvent(
      ctx.spies.auditStore,
      "player.profile.image.delete"
    );
    assert.ok(event);
  } finally {
    await ctx.close();
  }
});

test("GAP #5: data-URL-prefiks blir strippet før base64-decode", async () => {
  const ctx = await startServer(makeUser());
  try {
    const png = makePngBytes(200, 200);
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    const res = await req(
      `${ctx.baseUrl}/api/players/me/profile/image?category=profile`,
      "POST",
      "alice-token",
      { imageBase64: dataUrl }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mimeType, "image/png");
  } finally {
    await ctx.close();
  }
});
