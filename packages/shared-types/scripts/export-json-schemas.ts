/**
 * BIN-527: generate JSON-Schema exports from the Zod source of truth.
 *
 * Output lands in `packages/shared-types/generated/json-schemas/` — one
 * `.json` file per schema. The C# side of the legacy Unity bridge can then
 * validate incoming payloads against these files without pulling in the
 * TypeScript toolchain.
 *
 * Run:
 *   npm --prefix packages/shared-types run schema:export
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  RoomUpdatePayloadSchema,
  DrawNewPayloadSchema,
  ClaimSubmitPayloadSchema,
  TicketReplacePayloadSchema,
  BetArmPayloadSchema,
  TicketMarkPayloadSchema,
  PatternWonPayloadSchema,
  ChatMessageSchema,
  MiniGamePlayResultSchema,
  MiniGameActivatedPayloadSchema,
} from "../src/schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "generated", "json-schemas");

const exports: Array<[string, unknown]> = [
  ["RoomUpdatePayload", RoomUpdatePayloadSchema],
  ["DrawNewPayload", DrawNewPayloadSchema],
  ["ClaimSubmitPayload", ClaimSubmitPayloadSchema],
  ["TicketReplacePayload", TicketReplacePayloadSchema],
  ["BetArmPayload", BetArmPayloadSchema],
  ["TicketMarkPayload", TicketMarkPayloadSchema],
  ["PatternWonPayload", PatternWonPayloadSchema],
  ["ChatMessage", ChatMessageSchema],
  ["MiniGamePlayResult", MiniGamePlayResultSchema],
  ["MiniGameActivatedPayload", MiniGameActivatedPayloadSchema],
];

mkdirSync(outDir, { recursive: true });
for (const [name, schema] of exports) {
  const jsonSchema = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], name);
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(jsonSchema, null, 2) + "\n");
  // eslint-disable-next-line no-console
  console.log(`wrote generated/json-schemas/${name}.json`);
}
