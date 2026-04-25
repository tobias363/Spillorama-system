/**
 * Unit tests for image-validering (GAP #5).
 *
 * Sjekker magic-byte-deteksjon, dimensjons-parsing og rejection-stier.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  LocalImageStorageAdapter,
  validateImageBase64,
  MAX_IMAGE_BYTES,
} from "./ImageStorageService.js";
import { DomainError } from "../game/BingoEngine.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePngBytes(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = Buffer.alloc(25);
  ihdrChunk.writeUInt32BE(13, 0);
  ihdrChunk.write("IHDR", 4, "ascii");
  ihdrChunk.writeUInt32BE(width, 8);
  ihdrChunk.writeUInt32BE(height, 12);
  ihdrChunk.writeUInt8(8, 16);
  ihdrChunk.writeUInt8(2, 17);
  ihdrChunk.writeUInt8(0, 18);
  ihdrChunk.writeUInt8(0, 19);
  ihdrChunk.writeUInt8(0, 20);
  return Buffer.concat([sig, ihdrChunk]);
}

function makeJpegBytes(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.alloc(2 + 16);
  app0.writeUInt8(0xff, 0);
  app0.writeUInt8(0xe0, 1);
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF", 4, "ascii");
  const sof0 = Buffer.alloc(2 + 11);
  sof0.writeUInt8(0xff, 0);
  sof0.writeUInt8(0xc0, 1);
  sof0.writeUInt16BE(11, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(3, 9);
  return Buffer.concat([soi, app0, sof0]);
}

function makeWebpVp8xBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUInt32LE(10, 16);
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

// ── Validation tests ─────────────────────────────────────────────────────────

test("validateImageBase64: detects PNG via magic-bytes", () => {
  const png = makePngBytes(200, 200);
  const v = validateImageBase64(png.toString("base64"), "image/png");
  assert.equal(v.mimeType, "image/png");
  assert.equal(v.extension, "png");
  assert.equal(v.width, 200);
  assert.equal(v.height, 200);
});

test("validateImageBase64: detects JPEG via magic-bytes", () => {
  const jpg = makeJpegBytes(640, 480);
  const v = validateImageBase64(jpg.toString("base64"));
  assert.equal(v.mimeType, "image/jpeg");
  assert.equal(v.extension, "jpg");
  assert.equal(v.width, 640);
  assert.equal(v.height, 480);
});

test("validateImageBase64: detects WEBP (VP8X) via magic-bytes", () => {
  const webp = makeWebpVp8xBytes(1024, 768);
  const v = validateImageBase64(webp.toString("base64"));
  assert.equal(v.mimeType, "image/webp");
  assert.equal(v.width, 1024);
  assert.equal(v.height, 768);
});

test("validateImageBase64: strips data-URL prefiks", () => {
  const png = makePngBytes(200, 200);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const v = validateImageBase64(dataUrl);
  assert.equal(v.mimeType, "image/png");
});

test("validateImageBase64: tom string → INVALID_INPUT", () => {
  assert.throws(() => validateImageBase64(""), (err: unknown) => {
    return err instanceof DomainError && err.code === "INVALID_INPUT";
  });
});

test("validateImageBase64: ikke-base64 input → INVALID_INPUT", () => {
  assert.throws(
    () => validateImageBase64("dette er ikke base64 ÆØÅ"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("validateImageBase64: PDF-bytes → IMAGE_INVALID_FORMAT", () => {
  const pdfBytes = Buffer.from("%PDF-1.4\nfake content\n", "utf-8");
  assert.throws(
    () => validateImageBase64(pdfBytes.toString("base64")),
    (err: unknown) => err instanceof DomainError && err.code === "IMAGE_INVALID_FORMAT"
  );
});

test("validateImageBase64: 99x99 PNG → IMAGE_TOO_SMALL", () => {
  const png = makePngBytes(99, 99);
  assert.throws(
    () => validateImageBase64(png.toString("base64")),
    (err: unknown) => err instanceof DomainError && err.code === "IMAGE_TOO_SMALL"
  );
});

test("validateImageBase64: 5000x5000 PNG → IMAGE_TOO_LARGE_DIMENSIONS", () => {
  const png = makePngBytes(5000, 5000);
  assert.throws(
    () => validateImageBase64(png.toString("base64")),
    (err: unknown) =>
      err instanceof DomainError && err.code === "IMAGE_TOO_LARGE_DIMENSIONS"
  );
});

test("validateImageBase64: 6 MB-padded PNG → IMAGE_TOO_LARGE", () => {
  const header = makePngBytes(200, 200);
  const padding = Buffer.alloc(MAX_IMAGE_BYTES + 1024, 0);
  const big = Buffer.concat([header, padding]);
  assert.throws(
    () => validateImageBase64(big.toString("base64")),
    (err: unknown) => err instanceof DomainError && err.code === "IMAGE_TOO_LARGE"
  );
});

// ── LocalImageStorageAdapter tests ───────────────────────────────────────────

test("LocalImageStorageAdapter: skriver fil til disk og returnerer URL", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spillorama-img-"));
  try {
    const adapter = new LocalImageStorageAdapter({
      storageDir: dir,
      urlPrefix: "/uploads/profile-images",
    });
    const png = makePngBytes(200, 200);
    const validated = validateImageBase64(png.toString("base64"));
    const result = await adapter.store({
      userId: "user-alice",
      category: "profile",
      image: validated,
    });
    assert.match(result.url, /^\/uploads\/profile-images\/user-alice_profile_[a-f0-9]+\.png$/);
    // Filen skal være lesbar fra disk.
    const filename = result.url.split("/").pop()!;
    const onDisk = await readFile(path.join(dir, filename));
    assert.deepEqual(onDisk, png);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LocalImageStorageAdapter: sanitizer userId i filename", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spillorama-img-"));
  try {
    const adapter = new LocalImageStorageAdapter({
      storageDir: dir,
      urlPrefix: "/uploads/profile-images",
    });
    const png = makePngBytes(200, 200);
    const validated = validateImageBase64(png.toString("base64"));
    const result = await adapter.store({
      userId: "user/with../slashes!",
      category: "bankid_selfie",
      image: validated,
    });
    // Sanitizer skal erstatte ulovlige tegn med "_".
    assert.match(result.url, /\/user_with___slashes_/);
    assert.equal(result.url.includes("../"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LocalImageStorageAdapter: normaliserer urlPrefix (legger til '/' og strip trailing)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spillorama-img-"));
  try {
    const adapter = new LocalImageStorageAdapter({
      storageDir: dir,
      urlPrefix: "uploads/profile-images/",
    });
    const png = makePngBytes(200, 200);
    const validated = validateImageBase64(png.toString("base64"));
    const result = await adapter.store({
      userId: "u1",
      category: "profile",
      image: validated,
    });
    assert.match(result.url, /^\/uploads\/profile-images\/u1_profile_/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
