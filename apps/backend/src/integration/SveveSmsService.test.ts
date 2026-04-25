/**
 * Unit-tester for SveveSmsService.
 *
 * Dekning:
 *   - Stub-mode (ingen SVEVE_API_USER) — ok=true, skipped=true, ingen
 *     fetch-kall.
 *   - Live-mode happy-path: én POST til Sveve, parsed messageId.
 *   - Sveve-error i 200-respons (errors[]-array) — permanent, ikke retry.
 *   - HTTP 5xx — retry inntil maxRetries.
 *   - HTTP 4xx — permanent, ikke retry.
 *   - sendBulk → sekvensielle kall + items[]-summer.
 *   - maskPhone — sensitive data ikke lekket.
 *   - Validering — tom message, tom to, malformed sender.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SveveSmsService,
  maskPhone,
  type SveveHttpFetch,
} from "./SveveSmsService.js";

interface FetchCall {
  url: string;
  body: URLSearchParams;
}

function makeFakeFetch(
  responses: Array<{
    ok: boolean;
    status: number;
    text: string;
  }>
): { fetch: SveveHttpFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl: SveveHttpFetch = async (url, init) => {
    calls.push({ url, body: init.body });
    const r =
      responses[Math.min(i, responses.length - 1)] ?? {
        ok: false,
        status: 500,
        text: "out of fixtures",
      };
    i++;
    return {
      ok: r.ok,
      status: r.status,
      text: async () => r.text,
    };
  };
  return { fetch: fetchImpl, calls };
}

const noSleep = async (_ms: number) => undefined;

// ── maskPhone ────────────────────────────────────────────────────────────────

test("maskPhone: +47-prefix bevarer landskode + siste 4", () => {
  assert.equal(maskPhone("+4798765432"), "+47****5432");
});

test("maskPhone: 8-sifret norsk uten landskode", () => {
  assert.equal(maskPhone("98765432"), "****5432");
});

test("maskPhone: tomt input → (empty)", () => {
  assert.equal(maskPhone(""), "(empty)");
  assert.equal(maskPhone("   "), "(empty)");
});

test("maskPhone: kort nummer (≤4) maskes helt", () => {
  assert.equal(maskPhone("123"), "****123");
});

// ── Stub-mode ────────────────────────────────────────────────────────────────

test("stub-mode (ingen config) returnerer ok=true skipped=true uten fetch-kall", async () => {
  const { fetch, calls } = makeFakeFetch([]);
  const svc = new SveveSmsService({ config: null, fetchImpl: fetch });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Din OTP er 123456.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(svc.isEnabled(), false);
  assert.match(result.messageId ?? "", /^stub-/);
  assert.equal(calls.length, 0, "ingen fetch-kall i stub-mode");
});

// ── Happy-path live-mode ─────────────────────────────────────────────────────

test("live-mode happy-path: parser msgId fra Sveve-respons", async () => {
  const { fetch, calls } = makeFakeFetch([
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { msgOkCount: 1, stdSMSCount: 1, ids: [12345] },
      }),
    },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "test-user",
      password: "test-pass",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "OTP: 123456",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.messageId, "12345");
  assert.equal(result.parts, 1);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);

  // Verifiser at body inneholder riktige felter (ingen lekkasje av password
  // i log skal forekomme — vi tester at kallet konstrueres korrekt).
  const body = calls[0]!.body;
  assert.equal(body.get("user"), "test-user");
  assert.equal(body.get("to"), "+4798765432");
  assert.equal(body.get("msg"), "OTP: 123456");
  assert.equal(body.get("from"), "Spillorama");
  assert.equal(body.get("f"), "json");
});

test("live-mode: custom sender overrider default", async () => {
  const { fetch, calls } = makeFakeFetch([
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { msgOkCount: 1, stdSMSCount: 1, ids: [99] },
      }),
    },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Hei",
    sender: "Bingo",
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0]!.body.get("from"), "Bingo");
});

// ── Sveve API error ─────────────────────────────────────────────────────────

test("Sveve 200 + errors[]: permanent, ingen retry", async () => {
  const { fetch, calls } = makeFakeFetch([
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: {
          errors: [{ number: "+4798765432", message: "Ugyldig nummer" }],
        },
      }),
    },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Hei",
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1, "ingen retry på permanent feil");
  assert.match(result.error ?? "", /Ugyldig nummer/);
  assert.equal(calls.length, 1);
});

// ── HTTP-feil ────────────────────────────────────────────────────────────────

test("HTTP 500 retries inntil maxRetries og gir opp med ok=false", async () => {
  const { fetch, calls } = makeFakeFetch([
    { ok: false, status: 500, text: "Internal" },
    { ok: false, status: 500, text: "Internal" },
    { ok: false, status: 500, text: "Internal" },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
    maxRetries: 3,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Hei",
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.match(result.error ?? "", /HTTP 500/);
});

test("HTTP 5xx → 200 succeeded retry: andre forsøk lykkes", async () => {
  const { fetch, calls } = makeFakeFetch([
    { ok: false, status: 502, text: "Bad gateway" },
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { msgOkCount: 1, stdSMSCount: 1, ids: [42] },
      }),
    },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
    maxRetries: 3,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Hei",
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "42");
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
});

test("HTTP 401 (auth) er permanent — ingen retry", async () => {
  const { fetch, calls } = makeFakeFetch([
    { ok: false, status: 401, text: "Unauthorized" },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Hei",
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
});

// ── Validering ───────────────────────────────────────────────────────────────

test("sendSms uten `to` kaster", async () => {
  const svc = new SveveSmsService({ config: null });
  await assert.rejects(() => svc.sendSms({ to: "", message: "hei" }), /to/);
});

test("sendSms uten message kaster", async () => {
  const svc = new SveveSmsService({ config: null });
  await assert.rejects(
    () => svc.sendSms({ to: "+4798765432", message: "" }),
    /message/
  );
});

test("sendSms med for lang melding kaster", async () => {
  const svc = new SveveSmsService({ config: null });
  await assert.rejects(
    () =>
      svc.sendSms({
        to: "+4798765432",
        message: "x".repeat(1001),
      }),
    /1000 tegn/
  );
});

test("sendSms med ugyldig sender (>11 tegn) kaster", async () => {
  const svc = new SveveSmsService({ config: null });
  await assert.rejects(
    () =>
      svc.sendSms({
        to: "+4798765432",
        message: "hei",
        sender: "TooLongSender",
      }),
    /11 tegn/
  );
});

test("sendSms med non-alfa sender kaster", async () => {
  const svc = new SveveSmsService({ config: null });
  await assert.rejects(
    () =>
      svc.sendSms({
        to: "+4798765432",
        message: "hei",
        sender: "Bin go!",
      }),
    /alfanumeriske/
  );
});

// ── sendBulk ────────────────────────────────────────────────────────────────

test("sendBulk i stub-mode: alle skipped, ingen fetch-kall", async () => {
  const { fetch, calls } = makeFakeFetch([]);
  const svc = new SveveSmsService({ config: null, fetchImpl: fetch });

  const result = await svc.sendBulk(
    ["+4798765432", "+4791234567", "+4799999999"],
    "Bingo i kveld!"
  );

  assert.equal(result.total, 3);
  assert.equal(result.skipped, 3);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 0);
  // items[].to skal være masked.
  for (const item of result.items) {
    assert.match(item.to, /^\+47\*\*\*\*/);
  }
});

test("sendBulk i live-mode: blandet success/failure", async () => {
  const { fetch, calls } = makeFakeFetch([
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { msgOkCount: 1, stdSMSCount: 1, ids: [1] },
      }),
    },
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { errors: [{ message: "Ugyldig nummer" }] },
      }),
    },
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { msgOkCount: 1, stdSMSCount: 1, ids: [3] },
      }),
    },
  ]);
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: noSleep,
  });

  const result = await svc.sendBulk(
    ["+4798765432", "+4711111111", "+4799999999"],
    "Hei"
  );

  assert.equal(result.total, 3);
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 0);
  assert.equal(calls.length, 3);
});

// ── Backoff ─────────────────────────────────────────────────────────────────

test("retry bruker exponential backoff (1s, 2s)", async () => {
  const { fetch } = makeFakeFetch([
    { ok: false, status: 503, text: "" },
    { ok: false, status: 503, text: "" },
    {
      ok: true,
      status: 200,
      text: JSON.stringify({
        response: { msgOkCount: 1, stdSMSCount: 1, ids: [7] },
      }),
    },
  ]);
  const sleepCalls: number[] = [];
  const svc = new SveveSmsService({
    config: {
      user: "u",
      password: "p",
      defaultSender: "Spillorama",
      apiUrl: "https://sveve.no/SMS/SendMessage",
    },
    fetchImpl: fetch,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    maxRetries: 3,
    backoffBaseMs: 1000,
  });

  const result = await svc.sendSms({
    to: "+4798765432",
    message: "Hei",
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  // Backoff er etter forsøk 1 (1000ms) og etter forsøk 2 (2000ms).
  // Etter siste forsøk er det ingen sleep.
  assert.deepEqual(sleepCalls, [1000, 2000]);
});

// ── Sender-config validation ─────────────────────────────────────────────────

test("env-config med tom SVEVE_API_USER → null (stub-mode)", () => {
  const svc = new SveveSmsService({
    env: { SVEVE_API_USER: "", SVEVE_API_PASSWORD: "x" },
  });
  assert.equal(svc.isEnabled(), false);
});

test("env-config med SVEVE_API_USER men tom password → null (warn)", () => {
  const svc = new SveveSmsService({
    env: { SVEVE_API_USER: "user", SVEVE_API_PASSWORD: "" },
  });
  assert.equal(svc.isEnabled(), false);
});

test("env-config med begge satt → enabled", () => {
  const svc = new SveveSmsService({
    env: {
      SVEVE_API_USER: "user",
      SVEVE_API_PASSWORD: "pass",
      SVEVE_DEFAULT_SENDER: "Bingo",
    },
  });
  assert.equal(svc.isEnabled(), true);
});
