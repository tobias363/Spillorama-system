import path from "node:path";
import { FileWalletAdapter } from "./FileWalletAdapter.js";
import { HttpWalletAdapter } from "./HttpWalletAdapter.js";
import { PostgresWalletAdapter } from "./PostgresWalletAdapter.js";
import type { WalletAdapter } from "./WalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";
import { ExternalWalletAdapter } from "../integration/ExternalWalletAdapter.js";

export interface WalletAdapterRuntime {
  adapter: WalletAdapter;
  provider: "file" | "http" | "postgres" | "external";
}

function parseNonNegativeNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new WalletError("INVALID_WALLET_CONFIG", `${name} må være 0 eller større.`);
  }
  return parsed;
}

function parsePositiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new WalletError("INVALID_WALLET_CONFIG", `${name} må være større enn 0.`);
  }
  return parsed;
}

export function createWalletAdapter(projectDir: string): WalletAdapterRuntime {
  const provider = (process.env.WALLET_PROVIDER ?? "file").trim().toLowerCase();
  const defaultInitialBalance = parseNonNegativeNumberFromEnv("WALLET_DEFAULT_INITIAL_BALANCE", 1000);

  if (provider === "http") {
    const baseUrl = process.env.WALLET_API_BASE_URL?.trim();
    if (!baseUrl) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_API_BASE_URL må settes når WALLET_PROVIDER=http.");
    }
    const apiPrefix = process.env.WALLET_API_PREFIX?.trim() || "/api";
    const apiKey = process.env.WALLET_API_KEY?.trim();
    const timeoutMs = parsePositiveNumberFromEnv("WALLET_API_TIMEOUT_MS", 8000);
    return {
      provider: "http",
      adapter: new HttpWalletAdapter({
        baseUrl,
        apiPrefix,
        apiKey,
        timeoutMs,
        defaultInitialBalance
      })
    };
  }

  if (provider === "file") {
    const configuredPath = process.env.WALLET_DATA_PATH?.trim();
    const dataFilePath = configuredPath
      ? path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(projectDir, configuredPath)
      : path.resolve(projectDir, "backend/data/wallets.json");
    return {
      provider: "file",
      adapter: new FileWalletAdapter({
        dataFilePath,
        defaultInitialBalance
      })
    };
  }

  if (provider === "postgres" || provider === "pg") {
    const connectionString = process.env.WALLET_PG_CONNECTION_STRING?.trim();
    if (!connectionString) {
      throw new WalletError(
        "INVALID_WALLET_CONFIG",
        "WALLET_PG_CONNECTION_STRING må settes når WALLET_PROVIDER=postgres."
      );
    }
    const schema = process.env.WALLET_PG_SCHEMA?.trim() || "public";
    const sslRaw = process.env.WALLET_PG_SSL?.trim().toLowerCase();
    const ssl =
      sslRaw === "1" ||
      sslRaw === "true" ||
      sslRaw === "yes" ||
      sslRaw === "on";

    return {
      provider: "postgres",
      adapter: new PostgresWalletAdapter({
        connectionString,
        schema,
        ssl,
        defaultInitialBalance
      })
    };
  }

  if (provider === "external") {
    const baseUrl = process.env.WALLET_API_BASE_URL?.trim();
    if (!baseUrl) {
      throw new WalletError("INVALID_WALLET_CONFIG", "WALLET_API_BASE_URL må settes når WALLET_PROVIDER=external.");
    }
    const apiKey = process.env.WALLET_API_KEY?.trim();
    const timeoutMs = parsePositiveNumberFromEnv("WALLET_API_TIMEOUT_MS", 5000);
    const currency = process.env.WALLET_CURRENCY?.trim() || "NOK";
    return {
      provider: "external",
      adapter: new ExternalWalletAdapter({
        baseUrl,
        apiKey,
        timeoutMs,
        currency
      })
    };
  }

  throw new WalletError(
    "INVALID_WALLET_CONFIG",
    `Ukjent WALLET_PROVIDER "${provider}". Bruk "file", "http", "postgres" eller "external".`
  );
}
