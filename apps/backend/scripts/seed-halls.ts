#!/usr/bin/env npx tsx
/**
 * Seed all 22 Teknobingo/Spillorama halls into the database.
 *
 * Usage:
 *   npx tsx scripts/seed-halls.ts
 *
 * Requires APP_PG_CONNECTION_STRING in backend/.env
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PlatformService } from "../src/platform/PlatformService.js";
import { InMemoryWalletAdapter } from "../src/adapters/InMemoryWalletAdapter.js";

const halls = [
  {
    slug: "notodden",
    name: "Teknobingo Notodden AS",
    address: "Storgata 26, 3674 Notodden",
    organizationNumber: "989485229",
    settlementAccount: "1644.33.32611",
    invoiceMethod: "EHF",
  },
  {
    slug: "harstad",
    name: "Teknobingo Harstad AS",
    address: "Hans Egedes gate 12, 9405 Harstad",
    organizationNumber: "986523642",
    settlementAccount: "1503.19.31476",
    invoiceMethod: "EHF",
  },
  {
    slug: "sortland",
    name: "Teknobingo Sortland AS",
    address: "Vesterålsgata 58, 8400 Sortland",
    organizationNumber: "986523820",
    settlementAccount: "1503.19.31492",
    invoiceMethod: "EHF",
  },
  {
    slug: "bodo",
    name: "Teknobingo Bodø AS",
    address: "Dronningens gate 48, 8006 Bodø",
    organizationNumber: "986523774",
    settlementAccount: "1503.19.31425",
    invoiceMethod: "EHF",
  },
  {
    slug: "vinstra",
    name: "Teknobingo Vinstra AS",
    address: "Nedregata 58, 2640 Vinstra",
    organizationNumber: "895377732",
    settlementAccount: "1503.15.89492",
    invoiceMethod: "EHF",
  },
  {
    slug: "skien",
    name: "Spillorama Skien AS",
    address: "Henrik Ibsens gate 7, 3724 Skien",
    organizationNumber: "976478185",
    settlementAccount: "1503.11.77267",
    invoiceMethod: "EHF",
  },
  {
    slug: "stathelle",
    name: "Teknobingo Stathelle AS",
    address: "Krabberødveien 1, 3960 Stathelle",
    organizationNumber: "876477262",
    settlementAccount: "1503.11.77410",
    invoiceMethod: "EHF",
  },
  {
    slug: "larvik",
    name: "Teknobingo Larvik AS",
    address: "Olavs gate 15, 3256 Larvik",
    organizationNumber: "985297827",
    settlementAccount: "1638.09.34209",
    invoiceMethod: "EHF",
  },
  {
    slug: "arnes",
    name: "Teknobingo Årnes AS",
    address: "Høvlerigata 8, 2150 Årnes",
    organizationNumber: "992288701",
    settlementAccount: "1503.03.32609",
    invoiceMethod: "EHF",
  },
  {
    slug: "kragero",
    name: "Teknobingo Kragerø AS",
    address: "Frydensborgveien 4 A, 3772 Kragerø",
    organizationNumber: "974801140",
    settlementAccount: "1503.12.19970",
    invoiceMethod: "EHF",
  },
  {
    slug: "heimdal",
    name: "Teknobingo Heimdal AS",
    address: "Ringvålvegen 4 B, 7080 Heimdal",
    organizationNumber: "991636498",
    settlementAccount: "5083.06.70723",
    invoiceMethod: "EHF",
  },
  {
    slug: "gran",
    name: "Teknobingo Gran",
    address: "Storgata 28, 2750 Gran",
    organizationNumber: "992040521",
    settlementAccount: "1503.01.87021",
    invoiceMethod: "EHF",
  },
  {
    slug: "finnsnes",
    name: "Teknobingo Finnsnes AS",
    address: "Storgata 37, 9300 Finnsnes",
    organizationNumber: "986523685",
    settlementAccount: "1503.19.31441",
    invoiceMethod: "EHF",
  },
  {
    slug: "fauske",
    name: "Teknobingo Fauske AS",
    address: "Eliasbakken 9, 8200 Fauske",
    organizationNumber: "994864890",
    settlementAccount: "1503.13.23794",
    invoiceMethod: "EHF",
  },
  {
    slug: "sunndalsora",
    name: "Teknobingo Sunndalsøra AS",
    address: "Sunndalsvegen 4, 6600 Sunndalsøra",
    organizationNumber: "994256343",
    settlementAccount: "1503.11.25828",
    invoiceMethod: "EHF",
  },
  {
    slug: "lillehammer",
    name: "Teknobingo Lillehammer AS",
    address: "Gudbrandsdalsvegen 188, 2619 Lillehammer",
    organizationNumber: "995377691",
    settlementAccount: "1503.15.89476",
    invoiceMethod: "EHF",
  },
  {
    slug: "hamar",
    name: "Teknobingo Hamar AS",
    address: "Måsåbekkvegen 2, 2316 Hamar",
    organizationNumber: "995377705",
    settlementAccount: "1503.15.89433",
    invoiceMethod: "EHF",
  },
  {
    slug: "brumunddal",
    name: "Teknobingo Brumunddal AS",
    address: "Nygata 49 A, 2380 Brumunddal",
    organizationNumber: "995377683",
    settlementAccount: "1503.15.89506",
    invoiceMethod: "EHF",
  },
  {
    slug: "hokksund",
    name: "Spillorama Hokksund AS",
    address: "Stasjonsgata 36, 3300 Hokksund",
    organizationNumber: "991636552",
    settlementAccount: "5083.06.70847",
    invoiceMethod: "EHF",
  },
  {
    slug: "orkanger",
    name: "Teknobingo Orkanger AS",
    address: "Graastens gate 13, 7300 Orkanger",
    organizationNumber: "991636528",
    settlementAccount: "5083.06.70685",
    invoiceMethod: "EHF",
  },
  {
    slug: "kristiansund",
    name: "Spillorama Kristiansund AS",
    address: "Fosnagata 5, 6509 Kristiansund N",
    organizationNumber: "942443900",
    settlementAccount: "1506.99.47228",
    invoiceMethod: "EHF",
  },
];

async function main() {
  const connectionString = process.env.APP_PG_CONNECTION_STRING;
  if (!connectionString) {
    console.error("APP_PG_CONNECTION_STRING not set in .env");
    process.exit(1);
  }

  const wallet = new InMemoryWalletAdapter();
  const platform = new PlatformService(wallet, {
    connectionString,
    schema: process.env.APP_PG_SCHEMA || "public",
  });

  let created = 0;
  let skipped = 0;

  for (const hall of halls) {
    try {
      const result = await platform.createHall(hall);
      console.log(`  ✓ ${result.name} (${result.slug}) — ${result.organizationNumber}`);
      created++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("HALL_SLUG_EXISTS")) {
        console.log(`  · ${hall.name} (${hall.slug}) — allerede opprettet, hopper over`);
        skipped++;
      } else {
        console.error(`  ✗ ${hall.name} (${hall.slug}) — FEIL: ${message}`);
      }
    }
  }

  console.log(`\nFerdig: ${created} opprettet, ${skipped} allerede i databasen.`);
  process.exit(0);
}

main();
