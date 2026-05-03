/**
 * Tobias-direktiv 2026-05-03 (Agent EE):
 *
 * Boot-time clean-slate for test-spillere. Sletter ALLE rader i `app_users`
 * med `role = 'PLAYER'` (med tilhørende cascade-tabeller for sesjoner, KYC,
 * 2FA, PIN, profile-settings) og oppretter ÉN ny ferdig-konfigurert
 * test-bruker:
 *
 *   email:        test@spillorama.no
 *   password:     Test1234!
 *   displayName:  Test Bruker
 *   surname:      Tester
 *   birthDate:    1990-01-01
 *   kycStatus:    VERIFIED
 *   role:         PLAYER
 *   hallId:       demo-hall-001 (master-hall i pilot-gruppen)
 *   wallet:       5000 kr deposit-balance
 *
 * **VIKTIG — IKKE røres:**
 *   - AGENT-rader (alle bingoverter)
 *   - ADMIN-rader
 *   - HALL_OPERATOR-rader
 *   - SUPPORT-rader
 *   - app_halls / app_hall_groups (pilot-haller med agent-koblinger)
 *
 * Kun `role = 'PLAYER'` slettes — alle andre roller bevares uendret.
 *
 * **Idempotent:** trygt å kjøre flere ganger. Hvis test@spillorama.no
 * allerede finnes etter første kjøring, oppdateres den (ingen duplikat).
 *
 * **Fail-soft:** script-feil skal IKKE krasje boot. En catch-blokk i
 * boot-stedet logger feilen og fortsetter — pilot-skjemaet er viktigere
 * enn at script-en alltid lykkes.
 *
 * **Aktivering:** kjøres KUN når `RESET_TEST_PLAYERS=true` env-var er satt.
 * Default = no-op. PM aktiverer ved deploy ved å sette env-var, deploye, og
 * deretter fjerne env-var så scriptet ikke kjører igjen.
 *
 * **Cascade-håndtering:** majoriteten av FK-er fra app_users bruker
 * `ON DELETE CASCADE` (sessions, KYC, PIN, 2FA, profile-settings, hall-
 * registrations osv.). Et fåtall tabeller bruker `ON DELETE RESTRICT`
 * (compliance-ledger, draw-session-tickets, agent-transactions, orders,
 * settlements). For TEST-spillere som aldri har kjøpt en ticket/tatt en
 * deposit i prod vil disse være tomme — vi soft-deleter da fail-fast så
 * vi ikke ødelegger compliance-historikk hvis testene har generert reelle
 * transaksjoner.
 */

import { randomUUID, scrypt as scryptCallback, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";

const scrypt = promisify(scryptCallback);

/**
 * Pilot-master-hall (samme som `seed-demo-pilot-day.ts`). Spilleren
 * assignes hit slik at compliance-ledger og hall-rapporter peker på
 * en eksisterende hall (ikke null). Master-hall er trygt valg fordi
 * den er garantert aktiv i pilot-gruppen.
 */
const TEST_PLAYER_HALL_ID = "demo-hall-001";

const TEST_PLAYER_EMAIL = "test@spillorama.no";
const TEST_PLAYER_PASSWORD = "Test1234!";
const TEST_PLAYER_DISPLAY_NAME = "Test Bruker";
const TEST_PLAYER_SURNAME = "Tester";
const TEST_PLAYER_BIRTH_DATE = "1990-01-01";
const TEST_PLAYER_DEPOSIT_AMOUNT_KR = 5000;

export interface ResetTestPlayersResult {
  /** Antall PLAYER-rader som ble slettet før test-bruker ble opprettet/oppdatert. */
  deletedCount: number;
  /** Resulterende test-bruker (id + walletId så caller kan slå opp i logg). */
  testUser: {
    id: string;
    email: string;
    walletId: string;
    hallId: string;
    depositKr: number;
    /** True hvis raden var nyopprettet, false hvis eksisterende ble oppdatert. */
    created: boolean;
  };
}

export interface ResetTestPlayersDeps {
  pool: Pool;
  /**
   * Optional logger — defaulter til console.log/warn/error. Tester kan
   * injecte en stille logger for å unngå støy i test-output.
   */
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /**
   * Optional schema-prefiks for `app_users`-tabellen. Default `public`.
   * Boot-stedet bruker samme verdi som `APP_PG_SCHEMA` env-var.
   */
  schema?: string;
}

const DEFAULT_LOGGER = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[reset-test-players] ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[reset-test-players] ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[reset-test-players] ${msg}`, meta ? JSON.stringify(meta) : ""),
};

function assertSchemaName(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Ugyldig schema-navn: ${schema}`);
  }
  return schema;
}

/**
 * Hash et passord i samme format som PlatformService.hashPassword bruker
 * (`scrypt:<saltHex>:<digestHex>`). Kopiert hit fremfor å importere fra
 * PlatformService for å unngå sirkel-import (PlatformService trenger
 * walletAdapter som vi ikke vil binde inn her).
 */
async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(plaintext, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

/**
 * Hovedflyt:
 *   1) Tell + slett alle PLAYER-rader (cascade håndterer sessions/KYC/etc.)
 *   2) Opprett wallet-konto + INSERT test-bruker — eller UPDATE eksisterende.
 *   3) Topp opp wallet til 5000 kr (set, ikke add — så re-runs er idempotente).
 *   4) Sett kyc_status = 'VERIFIED' + birth_date + hall_id.
 *
 * All work skjer i én transaksjon. Hvis noe feiler, ROLLBACK gir helt
 * uendret state — ingen halv-slettet brukerbase.
 */
export async function resetTestPlayers(
  deps: ResetTestPlayersDeps,
): Promise<ResetTestPlayersResult> {
  const log = deps.logger ?? DEFAULT_LOGGER;
  const schema = assertSchemaName(deps.schema ?? "public");
  const usersTable = `"${schema}"."app_users"`;
  const walletAccountsTable = `"${schema}"."wallet_accounts"`;
  const walletTransactionsTable = `"${schema}"."wallet_transactions"`;
  const walletEntriesTable = `"${schema}"."wallet_entries"`;

  // 2026-05-03 (fix): split i to transaksjoner. TX1 oppretter test-brukeren
  // FØRST — så vi har en fungerende login uavhengig av om TX2 (delete andre
  // test-spillere) feiler på FK-RESTRICT (compliance-ledger / agent-tx /
  // settlement-rader). Tobias' direktiv var "gi meg en ny som funker" —
  // det er topp-prioritet, og opprydding av gamle er nice-to-have.

  // ── TX1: opprett/oppdater test@spillorama.no ─────────────────────────────
  const client = await deps.pool.connect();
  try {
    // 2026-05-03 fix: hardkodet TEST_PLAYER_HALL_ID="demo-hall-001"
    // eksisterer kanskje ikke i prod. Auto-pick første aktive hall fra DB
    // før transaksjonen, så INSERT/UPDATE har en garantert valid FK.
    const hallsTable = `"${schema}"."app_halls"`;
    let resolvedHallId: string = TEST_PLAYER_HALL_ID;
    try {
      const { rows: hallRows } = await client.query<{ id: string }>(
        `SELECT id FROM ${hallsTable} WHERE is_active = true ORDER BY created_at ASC LIMIT 1`,
      );
      if (hallRows[0]) {
        resolvedHallId = hallRows[0].id;
        if (resolvedHallId !== TEST_PLAYER_HALL_ID) {
          log.info(`Bruker første aktive hall ${resolvedHallId} (default ${TEST_PLAYER_HALL_ID} fantes ikke)`);
        }
      } else {
        log.warn(`Ingen aktive haller — beholder ${TEST_PLAYER_HALL_ID} (FK kan feile)`);
      }
    } catch (hallLookupErr) {
      log.warn(`Hall-lookup feilet, beholder ${TEST_PLAYER_HALL_ID}: ${hallLookupErr instanceof Error ? hallLookupErr.message : String(hallLookupErr)}`);
    }

    await client.query("BEGIN");

    const passwordHashEarly = await hashPassword(TEST_PLAYER_PASSWORD);
    const { rows: existingEarly } = await client.query<{ id: string; wallet_id: string }>(
      `SELECT id, wallet_id FROM ${usersTable} WHERE email = $1`,
      [TEST_PLAYER_EMAIL],
    );

    let userIdEarly: string;
    let walletIdEarly: string;
    let createdEarly: boolean;

    if (existingEarly[0]) {
      userIdEarly = existingEarly[0].id;
      walletIdEarly = existingEarly[0].wallet_id;
      createdEarly = false;
      await client.query(
        `UPDATE ${usersTable}
            SET password_hash = $2,
                display_name = $3,
                surname = $4,
                birth_date = $5::date,
                kyc_status = 'VERIFIED',
                kyc_verified_at = now(),
                hall_id = $6,
                role = 'PLAYER',
                deleted_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [userIdEarly, passwordHashEarly, TEST_PLAYER_DISPLAY_NAME, TEST_PLAYER_SURNAME, TEST_PLAYER_BIRTH_DATE, resolvedHallId],
      );
      log.info("Oppdaterte eksisterende test-bruker (TX1)", { userId: userIdEarly, walletId: walletIdEarly, hallId: resolvedHallId });
    } else {
      userIdEarly = randomUUID();
      walletIdEarly = `wallet-user-${userIdEarly}`;
      createdEarly = true;
      await client.query(
        `INSERT INTO ${usersTable}
           (id, email, display_name, surname, password_hash, wallet_id, role,
            kyc_status, birth_date, kyc_verified_at, hall_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'PLAYER',
                 'VERIFIED', $7::date, now(), $8)`,
        [userIdEarly, TEST_PLAYER_EMAIL, TEST_PLAYER_DISPLAY_NAME, TEST_PLAYER_SURNAME, passwordHashEarly, walletIdEarly, TEST_PLAYER_BIRTH_DATE, resolvedHallId],
      );
      log.info("Opprettet ny test-bruker (TX1)", { userId: userIdEarly, walletId: walletIdEarly, hallId: resolvedHallId });
    }

    await client.query(
      `INSERT INTO ${walletAccountsTable}
         (id, balance, deposit_balance, winnings_balance, is_system, created_at, updated_at)
       VALUES ($1, $2, $2, 0, false, now(), now())
       ON CONFLICT (id) DO UPDATE
         SET balance = EXCLUDED.balance,
             deposit_balance = EXCLUDED.deposit_balance,
             winnings_balance = 0,
             updated_at = now()`,
      [walletIdEarly, TEST_PLAYER_DEPOSIT_AMOUNT_KR],
    );

    await client.query("COMMIT");
    log.info(`TX1 ferdig: ${createdEarly ? "opprettet" : "oppdaterte"} ${TEST_PLAYER_EMAIL} med ${TEST_PLAYER_DEPOSIT_AMOUNT_KR} kr i hall ${resolvedHallId}`);

    // ── TX2: best-effort cleanup av andre test-spillere ─────────────────────
    let deletedCount = 0;
    try {
      deletedCount = await deleteOtherTestPlayersBestEffort(client, log, schema);
    } catch (cleanupErr) {
      log.warn(`TX2 cleanup feilet (best-effort, test-bruker er fortsatt klar): ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    }

    return {
      deletedCount,
      testUser: {
        id: userIdEarly,
        email: TEST_PLAYER_EMAIL,
        walletId: walletIdEarly,
        hallId: resolvedHallId,
        depositKr: TEST_PLAYER_DEPOSIT_AMOUNT_KR,
        created: createdEarly,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Best-effort sletting av andre PLAYER-rader. Itererer en-og-en og swallow-er
 * FK-RESTRICT-feil per spiller, så ÉN forurenset rad ikke stopper resten.
 */
async function deleteOtherTestPlayersBestEffort(
  client: import("pg").PoolClient,
  log: NonNullable<ResetTestPlayersDeps["logger"]>,
  schema: string,
): Promise<number> {
  const usersTable = `"${schema}"."app_users"`;
  const walletAccountsTable = `"${schema}"."wallet_accounts"`;
  const walletTransactionsTable = `"${schema}"."wallet_transactions"`;
  const walletEntriesTable = `"${schema}"."wallet_entries"`;

  const { rows: targets } = await client.query<{ id: string; wallet_id: string; email: string }>(
    `SELECT id, wallet_id, email FROM ${usersTable} WHERE role = 'PLAYER' AND email <> $1`,
    [TEST_PLAYER_EMAIL],
  );

  if (targets.length === 0) {
    log.info("Ingen andre test-spillere å rydde");
    return 0;
  }

  log.info(`TX2: prøver å slette ${targets.length} andre PLAYER-rader (per-rad fail-soft)`);

  let deleted = 0;
  for (const target of targets) {
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ${walletEntriesTable} WHERE account_id = $1`, [target.wallet_id]);
      await client.query(`DELETE FROM ${walletTransactionsTable} WHERE account_id = $1 OR related_account_id = $1`, [target.wallet_id]);
      await client.query(`DELETE FROM ${walletAccountsTable} WHERE id = $1 AND is_system = false`, [target.wallet_id]);
      await client.query(`DELETE FROM ${usersTable} WHERE id = $1`, [target.id]);
      await client.query("COMMIT");
      deleted++;
    } catch (perRowErr) {
      await client.query("ROLLBACK").catch(() => {});
      log.warn(`Skipper ${target.email} (FK-RESTRICT eller annen feil): ${perRowErr instanceof Error ? perRowErr.message : String(perRowErr)}`);
    }
  }

  log.info(`TX2 ferdig: slettet ${deleted}/${targets.length} test-spillere`);
  return deleted;
}

/**
 * @deprecated 2026-05-03: gammel single-transaksjons-flyt erstattet av split
 * (TX1 = create test-bruker, TX2 = best-effort delete). Bevart for backward-
 * compat referanse hvis noen tester eller scripts importerer den direkte.
 * Faktisk eksekverbar kode er fjernet under denne deklarasjonen.
 */
async function _legacyMonolithicResetUnused(
  deps: ResetTestPlayersDeps,
): Promise<ResetTestPlayersResult> {
  const log = deps.logger ?? DEFAULT_LOGGER;
  const schema = assertSchemaName(deps.schema ?? "public");
  const usersTable = `"${schema}"."app_users"`;
  const walletAccountsTable = `"${schema}"."wallet_accounts"`;
  const walletTransactionsTable = `"${schema}"."wallet_transactions"`;
  const walletEntriesTable = `"${schema}"."wallet_entries"`;

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Slett alle PLAYER-rader. Vi bruker hard DELETE fremfor soft-delete
    //    (deleted_at = now()) fordi Tobias eksplisitt ba om å fjerne
    //    test-spillere — soft-deletes ville bare skjule dem fra login-kall
    //    men la dem ligge igjen i admin-listings med "deleted"-flagg.
    //
    //    FK-cascade håndterer:
    //      - app_sessions (CASCADE)
    //      - app_user_pins (CASCADE, PK = user_id)
    //      - app_user_2fa (CASCADE, PK = user_id)
    //      - app_user_2fa_challenges (CASCADE)
    //      - app_user_profile_settings (CASCADE, PK = user_id)
    //      - app_hall_registrations (CASCADE)
    //      - app_password_reset_tokens / app_email_verification_tokens (CASCADE)
    //      - app_aml_red_flags (CASCADE for user_id)
    //      - app_player_lifecycle_events (CASCADE)
    //      - app_payment_requests (deposit/withdraw queue, CASCADE)
    //
    //    RESTRICT-tabeller (compliance-ledger, draw-session-tickets,
    //    agent-transactions, orders, settlements) blokkerer DELETE hvis
    //    test-spilleren har historikk der. For pure test-data (uten
    //    faktiske ticket-kjøp) er disse tomme. Hvis et test-spill genererte
    //    en ledger-rad, vil DELETE feile — det er bevisst, så vi ikke
    //    blæser bort regulatorisk historikk uten å vite det.
    //
    //    Wallet_accounts har ikke FK til app_users — vi må slette wallets
    //    eksplisitt. Vi finner dem via wallet_id-kolonnen først.
    const { rows: playerWalletRows } = await client.query<{
      id: string;
      wallet_id: string;
    }>(
      `SELECT id, wallet_id FROM ${usersTable} WHERE role = 'PLAYER' AND email <> $1`,
      [TEST_PLAYER_EMAIL],
    );

    let deletedCount = 0;
    if (playerWalletRows.length > 0) {
      log.info(
        `Sletter ${playerWalletRows.length} player-rader (alle role='PLAYER' unntatt ${TEST_PLAYER_EMAIL})`,
        { walletIds: playerWalletRows.map((r) => r.wallet_id).slice(0, 5) },
      );

      const walletIds = playerWalletRows.map((r) => r.wallet_id);

      // 1a) Slett wallet-historikk FØR wallet_accounts (FK fra
      //     wallet_transactions/wallet_entries → wallet_accounts uten
      //     CASCADE).
      await client.query(
        `DELETE FROM ${walletEntriesTable} WHERE account_id = ANY($1::text[])`,
        [walletIds],
      );
      await client.query(
        `DELETE FROM ${walletTransactionsTable} WHERE account_id = ANY($1::text[]) OR related_account_id = ANY($1::text[])`,
        [walletIds],
      );
      await client.query(
        `DELETE FROM ${walletAccountsTable} WHERE id = ANY($1::text[]) AND is_system = false`,
        [walletIds],
      );

      // 1b) Slett selve PLAYER-radene. Cascade håndterer KYC/sessions/PIN/2FA.
      const { rowCount: playerDeleteCount } = await client.query(
        `DELETE FROM ${usersTable} WHERE role = 'PLAYER' AND email <> $1`,
        [TEST_PLAYER_EMAIL],
      );
      deletedCount = playerDeleteCount ?? 0;
    } else {
      log.info("Ingen player-rader å slette (clean slate fra før)");
    }

    // 2) Opprett eller oppdater test@spillorama.no.
    const passwordHash = await hashPassword(TEST_PLAYER_PASSWORD);

    // Sjekk om test-bruker allerede finnes (fra forrige boot-kjøring).
    const { rows: existingRows } = await client.query<{
      id: string;
      wallet_id: string;
    }>(
      `SELECT id, wallet_id FROM ${usersTable} WHERE email = $1`,
      [TEST_PLAYER_EMAIL],
    );

    let userId: string;
    let walletId: string;
    let created: boolean;

    if (existingRows[0]) {
      // UPDATE-flow: bevarer userId + walletId, men oppdaterer passord +
      // KYC + birth_date + hall_id slik at brukeren garantert er klar
      // til bruk uavhengig av tidligere state.
      userId = existingRows[0].id;
      walletId = existingRows[0].wallet_id;
      created = false;
      await client.query(
        `UPDATE ${usersTable}
            SET password_hash = $2,
                display_name = $3,
                surname = $4,
                birth_date = $5::date,
                kyc_status = 'VERIFIED',
                kyc_verified_at = now(),
                hall_id = $6,
                role = 'PLAYER',
                deleted_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [
          userId,
          passwordHash,
          TEST_PLAYER_DISPLAY_NAME,
          TEST_PLAYER_SURNAME,
          TEST_PLAYER_BIRTH_DATE,
          TEST_PLAYER_HALL_ID,
        ],
      );
      log.info("Oppdaterte eksisterende test-bruker", { userId, walletId });
    } else {
      // INSERT-flow: ny bruker.
      userId = randomUUID();
      walletId = `wallet-user-${userId}`;
      created = true;
      await client.query(
        `INSERT INTO ${usersTable}
           (id, email, display_name, surname, password_hash, wallet_id, role,
            kyc_status, birth_date, kyc_verified_at, hall_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'PLAYER',
                 'VERIFIED', $7::date, now(), $8)`,
        [
          userId,
          TEST_PLAYER_EMAIL,
          TEST_PLAYER_DISPLAY_NAME,
          TEST_PLAYER_SURNAME,
          passwordHash,
          walletId,
          TEST_PLAYER_BIRTH_DATE,
          TEST_PLAYER_HALL_ID,
        ],
      );
      log.info("Opprettet ny test-bruker", { userId, walletId });
    }

    // 3) Sikre at wallet-konto finnes og har riktig deposit-balance.
    //    Vi bruker direkte UPSERT mot wallet_accounts fordi:
    //      - Vi vil sette en EKSAKT verdi (5000 kr), ikke addere — slik at
    //        re-runs er idempotente uavhengig av eksisterende balance.
    //      - PostgresWalletAdapter.topUp/credit ville generert ledger-
    //        entries som ikke matcher noen reell deposit-flyt og skapt
    //        støy i compliance-rapporter.
    //    Skriving direkte til wallet_accounts er trygt fordi den ikke
    //    inngår i pengespill-compliance-historikken — kun
    //    wallet_transactions/wallet_entries gjør det, og vi skriver IKKE
    //    dit her. (Dette er en ENGANGS test-bruker-seed, ikke en deposit
    //    fra spilleren.)
    await client.query(
      `INSERT INTO ${walletAccountsTable}
         (id, balance, deposit_balance, winnings_balance, is_system, created_at, updated_at)
       VALUES ($1, $2, $2, 0, false, now(), now())
       ON CONFLICT (id) DO UPDATE
         SET balance = EXCLUDED.balance,
             deposit_balance = EXCLUDED.deposit_balance,
             winnings_balance = 0,
             updated_at = now()`,
      [walletId, TEST_PLAYER_DEPOSIT_AMOUNT_KR],
    );

    await client.query("COMMIT");

    log.info(
      `Ferdig: slettet ${deletedCount} test-spillere, ${created ? "opprettet" : "oppdaterte"} ${TEST_PLAYER_EMAIL} med ${TEST_PLAYER_DEPOSIT_AMOUNT_KR} kr balance i hall ${TEST_PLAYER_HALL_ID}`,
    );

    return {
      deletedCount,
      testUser: {
        id: userId,
        email: TEST_PLAYER_EMAIL,
        walletId,
        hallId: TEST_PLAYER_HALL_ID,
        depositKr: TEST_PLAYER_DEPOSIT_AMOUNT_KR,
        created,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ignore — vi kaster den opprinnelige feilen.
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Eksponert for testbarhet — alle private konstanter samlet ett sted så
 * tester kan asserte forventede verdier uten å hardkode dem.
 */
export const _internals = {
  TEST_PLAYER_EMAIL,
  TEST_PLAYER_PASSWORD,
  TEST_PLAYER_DISPLAY_NAME,
  TEST_PLAYER_SURNAME,
  TEST_PLAYER_BIRTH_DATE,
  TEST_PLAYER_HALL_ID,
  TEST_PLAYER_DEPOSIT_AMOUNT_KR,
  hashPassword,
};
