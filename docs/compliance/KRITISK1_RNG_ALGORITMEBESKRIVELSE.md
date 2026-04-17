# RNG Algorithm Description — Spillorama Databingo

**Document purpose:** Formal algorithm description for submission to accredited RNG test laboratory.
**System:** Spillorama Databingo (60-ball variant)
**Date:** 10 April 2026
**Version:** 1.0

---

## 1. System Overview

Spillorama is a server-based databingo system using a 60-ball pool divided into 5 columns of 12 numbers each. The system generates two types of random output:

1. **Draw sequences** — a shuffled ordering of all 60 balls determining the draw order for a game.
2. **Player tickets** — 3x5 grids where each column contains 3 randomly selected numbers from its range.

All randomness is generated server-side. No client-side RNG is used.

---

## 2. Entropy Source

| Property | Value |
|----------|-------|
| **API** | `node:crypto.randomInt(max)` |
| **Runtime** | Node.js v25.x (LTS) |
| **Underlying CSPRNG** | OpenSSL `RAND_bytes()` via libuv |
| **Entropy pool** | OS-provided (`/dev/urandom` on Linux, `getentropy()` on macOS, `BCryptGenRandom` on Windows) |
| **Output** | Uniform random integer in `[0, max)` with no modulo bias |
| **Bias elimination** | Rejection sampling internal to Node.js (values outside the largest multiple of `max` that fits in the random range are discarded and resampled) |

### Node.js `randomInt` implementation

`crypto.randomInt(max)` generates a cryptographically secure random integer uniformly distributed over `[0, max)`. The implementation:

1. Draws random bytes from OpenSSL's CSPRNG (`RAND_bytes`).
2. Applies rejection sampling to eliminate modulo bias: if the drawn value falls outside `floor(2^k / max) * max` (where `k` is the bit width), it is discarded and a new value is drawn.
3. Returns the result modulo `max`.

This guarantees uniform distribution over the output range for any `max` value.

---

## 3. Shuffle Algorithm — Fisher-Yates (Knuth Variant)

### Source file
`backend/src/game/ticket.ts`, lines 7-14

### Implementation

```typescript
function shuffle<T>(values: T[]): T[] {
  const arr = [...values];             // non-destructive copy
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);        // uniform random in [0, i]
    [arr[i], arr[j]] = [arr[j], arr[i]]; // swap
  }
  return arr;
}
```

### Correctness properties

1. **Variant:** Descending (Durstenfeld) — iterates from last element to second.
2. **Random range:** `randomInt(i + 1)` produces values in `[0, i]` inclusive, which is correct for Fisher-Yates: each position `i` swaps with a uniformly random position from `[0, i]`.
3. **Permutation count:** For an array of `n` elements, the algorithm produces all `n!` permutations with equal probability, provided the underlying RNG is uniform over each range.
4. **No off-by-one:** The loop runs from `i = n-1` down to `i = 1` (inclusive). Position `0` does not need to swap with itself.
5. **No in-place mutation:** Input array is copied before shuffling.

---

## 4. Draw Sequence Generation

### Source file
`backend/src/game/ticket.ts`, line 31-33

### Implementation

```typescript
export function makeShuffledBallBag(maxNumber = 60): number[] {
  return shuffle(Array.from({ length: maxNumber }, (_, i) => i + 1));
}
```

### Process

1. Create array `[1, 2, 3, ..., 60]`.
2. Apply Fisher-Yates shuffle using `crypto.randomInt()`.
3. Return shuffled array — this is the complete draw sequence for one game.

### Properties

- All 60 balls appear exactly once (permutation, not sampling with replacement).
- Each of the `60!` possible orderings has equal probability.
- The sequence is generated once per game at game start and consumed incrementally.

---

## 5. Ticket Generation

### Source file
`backend/src/game/ticket.ts`, lines 35-56

### Column ranges

| Column | Number range | Size |
|--------|-------------|------|
| 0 | 1 - 12 | 12 numbers |
| 1 | 13 - 24 | 12 numbers |
| 2 | 25 - 36 | 12 numbers |
| 3 | 37 - 48 | 12 numbers |
| 4 | 49 - 60 | 12 numbers |

### Process

For each column:
1. Create array of all 12 numbers in the column's range.
2. Shuffle using Fisher-Yates.
3. Take the first 3 elements (equivalent to sampling 3 numbers without replacement).
4. Sort ascending for display consistency.

The result is a 3x5 grid where:
- Each column contains exactly 3 numbers from its range.
- All 15 cells contain a number (no free spaces).
- Each ticket is independently generated.

### Probability per cell

For a single column with range size 12, selecting 3 numbers:
- P(any specific number appears) = 3/12 = 0.25
- Total combinations per column: C(12,3) = 220
- Each combination equally likely

---

## 6. Integrity Controls

### 6.1 Draw sequence hash commitment

At game start, the full draw sequence is hashed and logged before any balls are drawn:

```typescript
drawBagHash: createHash("sha256").update(JSON.stringify(game.drawBag)).digest("hex")
```

This SHA-256 hash is written to the audit log, creating a cryptographic commitment that the sequence was determined before play began. The hash can be verified against the actual sequence post-game.

### 6.2 Checkpoint persistence

The full draw sequence is persisted in the database checkpoint (`RecoverableGameSnapshot.drawBag`) for crash recovery. This allows verification that the sequence used during play matches the committed hash.

### 6.3 Payout audit trail

Each payout generates a SHA-256 hash chain entry linking the claim to the game state at the time of validation.

---

## 7. Runtime Environment

| Component | Version / Detail |
|-----------|-----------------|
| Node.js | v25.x (LTS track) |
| OpenSSL | Bundled with Node.js (3.x series) |
| OS (production) | Linux (kernel 5.x+) — `/dev/urandom` entropy |
| Architecture | x86_64 / arm64 |
| Deployment | Containerized (Docker) on Render.com |

### Entropy considerations

- Linux `/dev/urandom` is seeded from hardware entropy sources (RDRAND, interrupt timing, etc.).
- The system does not run in a virtualized environment with known entropy starvation issues.
- No custom seeding or entropy injection is performed — the system relies entirely on OS-provided entropy via OpenSSL.

---

## 8. Internal Pre-Test Results

Statistical pre-testing was performed with 1,000,000 draw sequences and 1,000,000 tickets.

### Test results (2026-04-10)

| Test | Statistic | Threshold | Result |
|------|-----------|-----------|--------|
| Chi-squared: first position uniformity | 55.26 | 86.38 (p=0.01, df=59) | PASS |
| Chi-squared: all 60 positions uniformity | 82.16 (worst) | 86.38 (p=0.01, df=59) | PASS |
| Frequency range: max deviation | 2.85% | 5.0% | PASS |
| Chi-squared: ticket column distribution | 13.26 (worst) | 24.72 (p=0.01, df=11) | PASS |
| Serial correlation: adjacent pairs | z=1.592 | |z| < 3.0 | PASS |

Full results and raw data available in `backend/tools/rng-output/`.

### Test harness

The test harness (`backend/tools/rng-test-harness.ts`) can generate arbitrary volumes of draw sequences and tickets for independent testing. Usage:

```bash
npx tsx tools/rng-test-harness.ts --sequences 1000000 --tickets 1000000
```

Output files:
- `draw_sequences.csv` — one shuffled sequence per line (60 comma-separated integers)
- `tickets.csv` — one ticket per line (15 comma-separated integers, row-major)
- `position_frequency.csv` — frequency matrix (60 positions x 60 numbers)
- `summary.json` — machine-readable test results

---

## 9. Appendix: Source Code Listing

The complete RNG source code is contained in a single file: `backend/src/game/ticket.ts` (108 lines). This file contains:

- `shuffle<T>(values: T[]): T[]` — Fisher-Yates shuffle (lines 7-14)
- `pickUniqueInRange(start, end, count): number[]` — Random selection from range (lines 16-19)
- `makeShuffledBallBag(maxNumber): number[]` — Draw sequence generator (lines 31-33)
- `generateTraditional75Ticket(): Ticket` — Ticket generator (lines 35-56)

No other files in the system contain RNG logic. All randomness flows through the `shuffle()` function which uses `crypto.randomInt()`.
