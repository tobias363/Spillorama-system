/**
 * Sveve SMS-integrasjon (norsk SMS-leverandør).
 *
 * Use-cases:
 *   1) Forgot-password OTP for spillere uten e-post (men med telefonnummer).
 *   2) Admin broadcast av kritiske meldinger til spesifikke spillere
 *      (driftsmelding, hall-stengt, osv).
 *
 * Sveve REST API:
 *   POST https://sveve.no/SMS/SendMessage
 *   Body (form-encoded): user=…&passwd=…&to=…&msg=…&from=…&f=json
 *   Response (JSON): { response: { msgOkCount, stdSMSCount, ids[] } } ved
 *   suksess, eller { response: { errors: [...] } } ved feil.
 *
 * Env-vars:
 *   SVEVE_API_USER         brukernavn (tom = stub-mode)
 *   SVEVE_API_PASSWORD     passord
 *   SVEVE_DEFAULT_SENDER   default avsender-tekst (3-11 tegn, alfanumerisk)
 *   SVEVE_API_URL          override API-URL (default https://sveve.no/SMS/SendMessage)
 *
 * Stub-mode:
 *   Hvis SVEVE_API_USER er tom eller mangler, kjører service i stub-mode:
 *   `sendSms()` logger meldingen til stdout (uten phone, slik at ingen
 *   sensitive data lekker) og returnerer success med fake messageId. Egnet
 *   for dev + CI som ikke skal kontakte Sveve.
 *
 * Compliance:
 *   - Telefonnummer maskes i alle log-linjer + audit-detaljer (`+47****1234`).
 *   - OTP-koder logges ALDRI; bare hash-prefiks når debugging trengs.
 *   - Fail-soft: SMS-feil skal ikke krasje forgot-password-flyten — caller
 *     får success-flagg + skipped-felt og kan eventuelt fall-back til
 *     in-app-token-flyt.
 *
 * Retry-strategi:
 *   `sendSms()` retry-er inntil 3 ganger med exponential backoff (1s, 2s, 4s)
 *   ved nettverks-feil eller 5xx-respons. 4xx fra Sveve regnes som "permanent
 *   feil" og retry-es ikke (typisk ugyldig nummer-format eller bedrag-stoppet).
 *   Etter siste forsøk returneres `{ ok: false, error }` — caller bestemmer
 *   neste skritt.
 */

import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "sveve-sms-service" });

export interface SveveSmsConfig {
  /** Sveve API user (account name in Sveve customer portal). */
  user: string;
  /** Sveve API password. */
  password: string;
  /** Default sender label (3-11 chars). Caller can override per-message. */
  defaultSender: string;
  /** Override URL (used in tests). Default = `https://sveve.no/SMS/SendMessage`. */
  apiUrl: string;
}

export interface SendSmsInput {
  /** E.164-formatert nummer (`+4798765432`). Sveve aksepterer også 8-sifret norsk uten landskode. */
  to: string;
  /** SMS-tekst. Maks 1000 tegn (Sveve splitter automatisk i SMS-deler). */
  message: string;
  /** Override default sender (3-11 tegn alfanumerisk). */
  sender?: string;
}

export interface SendSmsResult {
  /** True hvis Sveve aksepterte forespørselen (eller stub-mode skipped). */
  ok: boolean;
  /** True hvis service kjørte i stub-mode (ingen ekte API-kall). */
  skipped: boolean;
  /** Sveve message-ID hvis suksess; null ellers. */
  messageId: string | null;
  /** Antall SMS-deler (lange meldinger blir splittet). */
  parts: number;
  /** Feilmelding hvis `ok=false`. */
  error: string | null;
  /** Antall forsøk benyttet (1-3). */
  attempts: number;
}

interface SveveApiSuccessResponse {
  response: {
    msgOkCount: number;
    stdSMSCount: number;
    ids?: number[];
  };
}

interface SveveApiErrorResponse {
  response: {
    errors: Array<{ number?: string; message?: string; reason?: string }>;
  };
}

/**
 * Minimal HTTP-client port. Lar tester injisere fake fetch uten å trenge en
 * ekte HTTP-server. Default-implementasjonen bruker global fetch.
 */
export interface SveveHttpFetch {
  (url: string, init: { method: "POST"; body: URLSearchParams }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface SveveSmsServiceOptions {
  config?: SveveSmsConfig | null;
  fetchImpl?: SveveHttpFetch;
  env?: NodeJS.ProcessEnv;
  /** Test-seam: sleep funksjon for backoff. Default = real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Test-seam: max retries override (default 3). */
  maxRetries?: number;
  /** Test-seam: backoff base ms (default 1000). */
  backoffBaseMs?: number;
}

function parseConfigFromEnv(env: NodeJS.ProcessEnv): SveveSmsConfig | null {
  const user = (env.SVEVE_API_USER ?? "").trim();
  const password = (env.SVEVE_API_PASSWORD ?? "").trim();
  if (!user) return null; // Stub-mode.
  if (!password) {
    logger.warn(
      "SVEVE_API_USER er satt men SVEVE_API_PASSWORD mangler — service disabled."
    );
    return null;
  }
  const defaultSender = (env.SVEVE_DEFAULT_SENDER ?? "").trim() || "Spillorama";
  const apiUrl =
    (env.SVEVE_API_URL ?? "").trim() || "https://sveve.no/SMS/SendMessage";
  return { user, password, defaultSender, apiUrl };
}

/**
 * Mask et telefonnummer for safe logging. Beholder landskode + siste 4 sifre.
 *   `+4798765432` → `+47****5432`
 *   `98765432`    → `****5432`
 */
export function maskPhone(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "(empty)";
  if (trimmed.startsWith("+")) {
    const cc = trimmed.slice(0, 3); // "+47"
    const tail = trimmed.slice(-4);
    return `${cc}****${tail}`;
  }
  if (trimmed.length <= 4) return `****${trimmed}`;
  return `****${trimmed.slice(-4)}`;
}

function normalizePhone(raw: string): string {
  return (raw || "").trim().replace(/\s+/g, "");
}

function assertSenderFormat(sender: string): void {
  if (sender.length < 3 || sender.length > 11) {
    throw new Error("Sender må være 3-11 tegn (Sveve-krav).");
  }
  if (!/^[a-zA-Z0-9]+$/.test(sender)) {
    throw new Error("Sender kan kun inneholde alfanumeriske tegn.");
  }
}

export class SveveSmsService {
  private readonly config: SveveSmsConfig | null;
  private readonly fetchImpl: SveveHttpFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(options: SveveSmsServiceOptions = {}) {
    this.config =
      options.config === undefined
        ? parseConfigFromEnv(options.env ?? process.env)
        : options.config;
    this.fetchImpl =
      options.fetchImpl ??
      (async (url, init) => {
        const resp = await fetch(url, {
          method: init.method,
          body: init.body,
        });
        return {
          ok: resp.ok,
          status: resp.status,
          text: () => resp.text(),
        };
      });
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
  }

  /** True når en ekte API-config er tilgjengelig. */
  isEnabled(): boolean {
    return this.config !== null;
  }

  /**
   * Send én SMS med automatic retry + exp backoff.
   *
   * Exception-policy:
   *   - Returnerer ALLTID en SendSmsResult — kaster ikke (med mindre input
   *     er strukturelt ugyldig).
   *   - Stub-mode: skipped=true, ok=true.
   *   - 4xx fra Sveve: ok=false, retry-es ikke.
   *   - 5xx / nettverk: retry inntil maxRetries, deretter ok=false.
   */
  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const to = normalizePhone(input.to);
    if (!to) {
      throw new Error("`to` er påkrevd.");
    }
    const message = (input.message ?? "").toString();
    if (!message.trim()) {
      throw new Error("`message` er påkrevd.");
    }
    if (message.length > 1000) {
      throw new Error("`message` kan maks være 1000 tegn (Sveve-grense).");
    }
    const sender = (input.sender ?? this.config?.defaultSender ?? "Spillorama").trim();
    if (sender) assertSenderFormat(sender);

    // Stub-mode: ingen API-kall. Logg masked nummer + msg-lengde, ikke selve
    // teksten (kan inneholde OTP-kode).
    if (!this.config) {
      logger.info(
        {
          to: maskPhone(to),
          msgLength: message.length,
          stub: true,
        },
        "[sveve-sms] STUB-mode — ingen API-kall, returnerer success"
      );
      return {
        ok: true,
        skipped: true,
        messageId: `stub-${Date.now()}`,
        parts: 1,
        error: null,
        attempts: 0,
      };
    }

    let lastError: string | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      attempts = attempt;
      try {
        const result = await this.callSveve(to, message, sender);
        if (result.ok) {
          return {
            ok: true,
            skipped: false,
            messageId: result.messageId,
            parts: result.parts,
            error: null,
            attempts,
          };
        }
        lastError = result.error;
        if (result.permanent) {
          // 4xx eller validation-feil — ikke retry.
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err, to: maskPhone(to), attempt },
          "[sveve-sms] kall feilet — vil retry hvis tilgjengelig"
        );
      }
      // Backoff før neste forsøk (ikke etter siste).
      if (attempt < this.maxRetries) {
        const backoffMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
        await this.sleep(backoffMs);
      }
    }

    return {
      ok: false,
      skipped: false,
      messageId: null,
      parts: 0,
      error: lastError ?? "Ukjent feil",
      attempts,
    };
  }

  /**
   * Send SMS til flere mottakere (én per nummer). Returnerer per-mottaker-
   * resultat for audit/log. Kjører sekvensielt for å holde oss innenfor
   * Sveve sin rate-limit (~10 msg/s anbefalt).
   */
  async sendBulk(
    recipients: string[],
    message: string,
    sender?: string
  ): Promise<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    items: Array<{
      to: string; // masked
      ok: boolean;
      messageId: string | null;
      error: string | null;
      skipped: boolean;
    }>;
  }> {
    const items: Array<{
      to: string;
      ok: boolean;
      messageId: string | null;
      error: string | null;
      skipped: boolean;
    }> = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const recipient of recipients) {
      const r = await this.sendSms({ to: recipient, message, sender });
      items.push({
        to: maskPhone(recipient),
        ok: r.ok,
        messageId: r.messageId,
        error: r.error,
        skipped: r.skipped,
      });
      if (r.skipped) skipped++;
      else if (r.ok) sent++;
      else failed++;
    }
    return { total: recipients.length, sent, failed, skipped, items };
  }

  /**
   * Lavnivå-kall til Sveve REST-API. Returnerer normalisert utfall.
   */
  private async callSveve(
    to: string,
    message: string,
    sender: string
  ): Promise<{
    ok: boolean;
    permanent: boolean;
    messageId: string | null;
    parts: number;
    error: string | null;
  }> {
    if (!this.config) {
      throw new Error("config er ikke initialisert (stub-mode)");
    }
    const body = new URLSearchParams();
    body.set("user", this.config.user);
    body.set("passwd", this.config.password);
    body.set("to", to);
    body.set("msg", message);
    body.set("from", sender);
    body.set("f", "json");

    const resp = await this.fetchImpl(this.config.apiUrl, {
      method: "POST",
      body,
    });

    const text = await resp.text();
    if (!resp.ok) {
      // 4xx er permanent (typisk auth eller ugyldig nummer); 5xx kan retry-es.
      return {
        ok: false,
        permanent: resp.status >= 400 && resp.status < 500,
        messageId: null,
        parts: 0,
        error: `HTTP ${resp.status}: ${text.slice(0, 200)}`,
      };
    }

    let parsed: SveveApiSuccessResponse | SveveApiErrorResponse;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        permanent: false,
        messageId: null,
        parts: 0,
        error: `Kunne ikke parse Sveve-respons: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    if ("errors" in parsed.response) {
      // Sveve returnerte 200 men med errors[]-array — typisk ugyldig nummer
      // eller blokkert mottaker. Permanent (ikke retry).
      const errs = parsed.response.errors;
      const message =
        errs[0]?.message ?? errs[0]?.reason ?? "Ukjent Sveve-feil";
      return {
        ok: false,
        permanent: true,
        messageId: null,
        parts: 0,
        error: `Sveve avviste: ${message}`,
      };
    }

    const ids = parsed.response.ids ?? [];
    return {
      ok: true,
      permanent: false,
      messageId: ids[0] != null ? String(ids[0]) : null,
      parts: parsed.response.stdSMSCount ?? 1,
      error: null,
    };
  }
}
