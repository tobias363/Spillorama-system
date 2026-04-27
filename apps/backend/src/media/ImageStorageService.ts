/**
 * ImageStorageService — pluggable storage for player profile + BankID image
 * uploads (GAP #5).
 *
 * Strategi:
 *   - Default: lokal-fil-storage under `<publicDir>/uploads/profile-images/`,
 *     servert via express.static.
 *   - TODO (oppfølger-issue): Cloudinary-adapter — env-vars `CLOUDINARY_*`
 *     finnes allerede i flere andre subsystem-er, men ingen aktiv integrasjon
 *     i ny stack ennå. Vi har bygget interfacet `ImageStorageAdapter` slik at
 *     en Cloudinary-implementasjon kan dropp-erstattes uten å berøre
 *     route-laget.
 *
 * Validering (eier av service-laget, ikke route-laget):
 *   - Format-detektering via "magic bytes" — vi støtter JPEG, PNG, WEBP.
 *   - Min/maks fil-størrelse (5 MB).
 *   - Min/maks dimensjoner (100×100 → 4096×4096) — leses ut av image-headeren
 *     uten å laste inn en full image-decoder.
 *
 * Persistens:
 *   - Filnavn = `<userId>_<category>_<random>.<ext>`. Sletter ikke gammelt
 *     bilde ved overskriving — disk-bruken er marginal og GDPR-sletting
 *     skjer via PlatformService.deleteAccount.
 *   - Returnerer en relativ URL (`/uploads/profile-images/<filename>`) som
 *     persistes på app_users-raden. Frontend kan fritt prefiksere med
 *     backend-base-URL.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { DomainError } from "../game/BingoEngine.js";

export type ImageCategory = "profile" | "bankid_selfie" | "bankid_document";

export interface ValidatedImage {
  /** Decoded raw bytes. */
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
  byteLength: number;
}

export interface UploadedImage {
  /** Public URL/storage-path persistet på app_users-raden. */
  url: string;
  mimeType: ValidatedImage["mimeType"];
  width: number;
  height: number;
  byteLength: number;
}

/**
 * Adapter-interfacet — Cloudinary kan implementere denne uten å endre
 * resten av call-pathen. Lokal storage er default-implementasjonen.
 */
export interface ImageStorageAdapter {
  store(input: {
    userId: string;
    category: ImageCategory;
    image: ValidatedImage;
  }): Promise<UploadedImage>;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_IMAGE_DIMENSION = 100;
export const MAX_IMAGE_DIMENSION = 4096;

// ── Validation: header parsing + bounds checks ──────────────────────────────

/**
 * Parse base64 input + assert MIME, dimensjoner, fil-størrelse. Sentral
 * validerings-funksjon brukt av route-laget. Kaster DomainError ved alle
 * feilmodi så caller mapper til 4xx via apiFailure.
 *
 * Aksepterer både "data:image/png;base64,...." og rå base64.
 */
export function validateImageBase64(
  rawInput: string,
  declaredMimeType?: string
): ValidatedImage {
  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    throw new DomainError("INVALID_INPUT", "imageBase64 mangler.");
  }

  // Stripp data-URL-prefiks "data:image/<x>;base64,...".
  const stripped = rawInput.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").trim();

  // Quick base64 sanity check — tillater whitespace, men ingen utøyelige
  // tegn. Buffer.from kaster ikke ved invalid base64 (ignorerer ukjente
  // tegn), så vi gjør sjekken eksplisitt.
  if (!/^[A-Za-z0-9+/=\s]+$/.test(stripped)) {
    throw new DomainError("INVALID_INPUT", "imageBase64 er ikke gyldig base64.");
  }

  const bytes = Buffer.from(stripped, "base64");
  if (bytes.length === 0) {
    throw new DomainError("INVALID_INPUT", "imageBase64 dekodet til 0 bytes.");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      `Bildet er for stort (${bytes.length} bytes). Maks ${MAX_IMAGE_BYTES} bytes.`
    );
  }

  // Magic-byte-deteksjon. Vi stoler ikke på declaredMimeType — klienten
  // kan lyge — men logger uoverensstemmelse via DomainError-meldingen
  // hvis caller har sendt feil MIME.
  const detected = detectImageFormat(bytes);
  if (!detected) {
    throw new DomainError(
      "IMAGE_INVALID_FORMAT",
      "Bildet må være JPEG, PNG eller WEBP."
    );
  }
  if (
    declaredMimeType &&
    typeof declaredMimeType === "string" &&
    declaredMimeType.trim() &&
    declaredMimeType.trim().toLowerCase() !== detected.mimeType
  ) {
    // Klart-text-feilmelding så vi vet hvorfor klienten kanskje kaller
    // dette feil. Kaster ikke — vi går videre med detected MIME.
  }

  const dims = readImageDimensions(bytes, detected.format);
  if (!dims) {
    throw new DomainError(
      "IMAGE_INVALID_FORMAT",
      "Klarte ikke å lese bilde-dimensjoner."
    );
  }
  if (dims.width < MIN_IMAGE_DIMENSION || dims.height < MIN_IMAGE_DIMENSION) {
    throw new DomainError(
      "IMAGE_TOO_SMALL",
      `Bildet må være minst ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION} pixler (var ${dims.width}x${dims.height}).`
    );
  }
  if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
    throw new DomainError(
      "IMAGE_TOO_LARGE_DIMENSIONS",
      `Bildet må være maks ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} pixler (var ${dims.width}x${dims.height}).`
    );
  }

  return {
    bytes,
    mimeType: detected.mimeType,
    extension: detected.extension,
    width: dims.width,
    height: dims.height,
    byteLength: bytes.length,
  };
}

interface DetectedFormat {
  format: "jpeg" | "png" | "webp";
  mimeType: ValidatedImage["mimeType"];
  extension: ValidatedImage["extension"];
}

function detectImageFormat(bytes: Buffer): DetectedFormat | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "jpeg", mimeType: "image/jpeg", extension: "jpg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { format: "png", mimeType: "image/png", extension: "png" };
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { format: "webp", mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

function readImageDimensions(
  bytes: Buffer,
  format: DetectedFormat["format"]
): { width: number; height: number } | null {
  if (format === "png") {
    // PNG IHDR chunk starter på offset 8 (etter 8-byte signature). IHDR
    // er første chunk: 4 bytes length + 4 bytes "IHDR" + width(4) + height(4).
    if (bytes.length < 24) return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return { width, height };
  }
  if (format === "jpeg") {
    return readJpegDimensions(bytes);
  }
  if (format === "webp") {
    return readWebpDimensions(bytes);
  }
  return null;
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  // Iterer SOI-segmenter til vi treffer SOFn-marker (C0..C3, C5..C7, C9..CB,
  // CD..CF). Standard JPEG SOF0 ligger etter en haug med APP-segmenter.
  let offset = 2; // skip SOI (FFD8)
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    while (marker === 0xff) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    if (marker === undefined) return null;
    offset += 2;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      // Vi er i en SOF-segment. Skip 3 bytes (segment-length 2 + precision 1)
      // og les 4 bytes (height + width).
      if (offset + 7 > bytes.length) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return { width, height };
    }
    // Ellers: hopp over segmentet (2-byte length, store-endian).
    if (offset + 2 > bytes.length) return null;
    const segLen = bytes.readUInt16BE(offset);
    offset += segLen;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } | null {
  // RIFF-header: "RIFF" + size(4) + "WEBP" + chunk-id(4) + chunk-size(4).
  // Vi støtter "VP8 ", "VP8L", "VP8X". Standard for "VP8 " (lossy):
  //   bytes 30..31 = width-2 LE, 32..33 = height-2 LE (men startsignaturen
  //   er på offset 14 → format-spesifikt). Enkleste standard er VP8X-chunk
  //   som har width-1 + height-1 i 24-bit LE på faste offsets.
  if (bytes.length < 30) return null;
  const chunkId = bytes.toString("ascii", 12, 16);
  if (chunkId === "VP8X") {
    // VP8X: bytes 24..26 = width-1 (LE 24-bit), 27..29 = height-1.
    const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
    const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (chunkId === "VP8 ") {
    // VP8 (lossy): width/height ligger på offsets 26..29 i 16-bit LE,
    // maskert med 0x3FFF.
    if (bytes.length < 30) return null;
    const w = (bytes.readUInt16LE(26) & 0x3fff);
    const h = (bytes.readUInt16LE(28) & 0x3fff);
    return { width: w, height: h };
  }
  if (chunkId === "VP8L") {
    // VP8L (lossless): width-1 (14 bit LE) + height-1 (14 bit) på offset 21.
    if (bytes.length < 25) return null;
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    const width = 1 + ((b1 & 0x3f) << 8 | b0);
    const height = 1 + ((b3 & 0x0f) << 10 | b2 << 2 | (b1 & 0xc0) >> 6);
    return { width, height };
  }
  return null;
}

// ── Local storage adapter ────────────────────────────────────────────────────

export interface LocalImageStorageOptions {
  /** Absolutt sti til mappen vi skriver til. Opprettes ved første kall. */
  storageDir: string;
  /** URL-prefiks som peker til samme mappe via express.static. */
  urlPrefix: string;
}

export class LocalImageStorageAdapter implements ImageStorageAdapter {
  private readonly storageDir: string;
  private readonly urlPrefix: string;

  constructor(opts: LocalImageStorageOptions) {
    this.storageDir = opts.storageDir;
    // Normaliser slik at vi alltid har én ledende `/` og ingen trailing.
    let prefix = opts.urlPrefix.trim();
    if (!prefix.startsWith("/")) prefix = `/${prefix}`;
    if (prefix.endsWith("/")) prefix = prefix.slice(0, -1);
    this.urlPrefix = prefix;
  }

  async store(input: {
    userId: string;
    category: ImageCategory;
    image: ValidatedImage;
  }): Promise<UploadedImage> {
    await mkdir(this.storageDir, { recursive: true });
    // Sanitize userId for filename — keep only [A-Za-z0-9_-].
    const safeUserId = input.userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
    const random = randomBytes(8).toString("hex");
    const filename = `${safeUserId}_${input.category}_${random}.${input.image.extension}`;
    const filepath = path.join(this.storageDir, filename);
    await writeFile(filepath, input.image.bytes);
    return {
      url: `${this.urlPrefix}/${filename}`,
      mimeType: input.image.mimeType,
      width: input.image.width,
      height: input.image.height,
      byteLength: input.image.byteLength,
    };
  }
}

// ── In-memory adapter (tests) ────────────────────────────────────────────────

export class InMemoryImageStorageAdapter implements ImageStorageAdapter {
  readonly stored: Array<{
    userId: string;
    category: ImageCategory;
    bytes: Buffer;
    extension: ValidatedImage["extension"];
    mimeType: ValidatedImage["mimeType"];
  }> = [];

  async store(input: {
    userId: string;
    category: ImageCategory;
    image: ValidatedImage;
  }): Promise<UploadedImage> {
    const random = randomBytes(4).toString("hex");
    const url = `/uploads/profile-images/${input.userId}_${input.category}_${random}.${input.image.extension}`;
    this.stored.push({
      userId: input.userId,
      category: input.category,
      bytes: input.image.bytes,
      extension: input.image.extension,
      mimeType: input.image.mimeType,
    });
    return {
      url,
      mimeType: input.image.mimeType,
      width: input.image.width,
      height: input.image.height,
      byteLength: input.image.byteLength,
    };
  }
}
