/**
 * Unit-tester for PlatformService.verifyHallTvToken.
 *
 * Dekker:
 *   - Gyldig (hallRef, token) → returnerer HallDefinition
 *   - Gal token → kaster TV_TOKEN_INVALID
 *   - Ukjent hall → kaster TV_TOKEN_INVALID (ikke HALL_NOT_FOUND, for
 *     uniform 404-respons i public-endpoint)
 *   - Inaktiv hall → kaster TV_TOKEN_INVALID
 *   - Tom token → kaster TV_TOKEN_INVALID
 *
 * Mønster: samme stub-pattern som hallDisplayTokens.test.ts — vi erstatter
 * ensureInitialized + getHall på en ekte PlatformService-instans slik at
 * verify-logikken testes uten DB.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PlatformService, type HallDefinition } from "../PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

function makeHall(
  id: string,
  tvToken: string,
  isActive = true
): HallDefinition {
  return {
    id,
    slug: id,
    name: `Hall ${id}`,
    region: "NO",
    address: "",
    isActive,
    clientVariant: "web",
    tvToken,
    createdAt: "2026-04-23T00:00:00Z",
    updatedAt: "2026-04-23T00:00:00Z",
  };
}

function makeService(halls: HallDefinition[]): PlatformService {
  const svc = new PlatformService({} as WalletAdapter, {
    connectionString: "postgres://noop/noop",
    schema: "public",
    sessionTtlHours: 1,
    minAgeYears: 18,
    kycAdapter: {
      verify: async () => ({ ok: true }),
    } as unknown as ConstructorParameters<typeof PlatformService>[1]["kycAdapter"],
  });
  const internal = svc as unknown as {
    ensureInitialized: () => Promise<void>;
    getHall: (ref: string) => Promise<HallDefinition>;
  };
  internal.ensureInitialized = async () => {};
  internal.getHall = async (ref) => {
    const h = halls.find((x) => x.id === ref || x.slug === ref);
    if (!h) throw new DomainError("HALL_NOT_FOUND", "not found");
    return h;
  };
  return svc;
}

test("verifyHallTvToken returns hall for matching (hallId, token)", async () => {
  const hall = makeHall("h1", "token-abc-123");
  const svc = makeService([hall]);
  const got = await svc.verifyHallTvToken("h1", "token-abc-123");
  assert.equal(got.id, "h1");
  assert.equal(got.tvToken, "token-abc-123");
});

test("verifyHallTvToken rejects mismatched token as TV_TOKEN_INVALID", async () => {
  const hall = makeHall("h1", "correct-token");
  const svc = makeService([hall]);
  await assert.rejects(
    () => svc.verifyHallTvToken("h1", "wrong-token"),
    (err: Error) => err instanceof DomainError && err.code === "TV_TOKEN_INVALID"
  );
});

test("verifyHallTvToken rejects unknown hall as TV_TOKEN_INVALID (not HALL_NOT_FOUND)", async () => {
  const svc = makeService([]);
  await assert.rejects(
    () => svc.verifyHallTvToken("ghost-hall", "anything"),
    (err: Error) => err instanceof DomainError && err.code === "TV_TOKEN_INVALID"
  );
});

test("verifyHallTvToken rejects inactive hall as TV_TOKEN_INVALID", async () => {
  const hall = makeHall("h1", "valid-token", false);
  const svc = makeService([hall]);
  await assert.rejects(
    () => svc.verifyHallTvToken("h1", "valid-token"),
    (err: Error) => err instanceof DomainError && err.code === "TV_TOKEN_INVALID"
  );
});

test("verifyHallTvToken rejects empty token", async () => {
  const hall = makeHall("h1", "valid-token");
  const svc = makeService([hall]);
  await assert.rejects(
    () => svc.verifyHallTvToken("h1", ""),
    (err: Error) => err instanceof DomainError && err.code === "TV_TOKEN_INVALID"
  );
});

test("verifyHallTvToken rejects token of different length (length-mismatch shortcut)", async () => {
  const hall = makeHall("h1", "short");
  const svc = makeService([hall]);
  await assert.rejects(
    () => svc.verifyHallTvToken("h1", "much-longer-token-here"),
    (err: Error) => err instanceof DomainError && err.code === "TV_TOKEN_INVALID"
  );
});
