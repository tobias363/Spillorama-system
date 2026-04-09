import assert from "node:assert/strict";
import test from "node:test";
import { buildBingoSettingsDefinition } from "./settingsCatalog.js";

test("bingo settings-katalog inkluderer payoutPercent med grenser", () => {
  const definition = buildBingoSettingsDefinition({
    minRoundIntervalMs: 30000,
    minPlayersToStart: 1,
    maxTicketsPerPlayer: 5,
    fixedAutoDrawIntervalMs: 2000,
    forceAutoStart: true,
    forceAutoDraw: true,
    runningRoundLockActive: false
  });

  const payoutField = definition.fields.find((field) => field.path === "payoutPercent");
  assert.ok(payoutField, "payoutPercent felt mangler");
  assert.equal(payoutField?.type, "number");
  assert.equal(payoutField?.min, 0);
  assert.equal(payoutField?.max, 100);
});

test("bingo settings-katalog setter lock når runde kjører", () => {
  const definition = buildBingoSettingsDefinition({
    minRoundIntervalMs: 30000,
    minPlayersToStart: 1,
    maxTicketsPerPlayer: 5,
    fixedAutoDrawIntervalMs: 2000,
    forceAutoStart: false,
    forceAutoDraw: false,
    runningRoundLockActive: true
  });

  assert.ok(definition.fields.length > 0);
  for (const field of definition.fields) {
    assert.equal(field.isLocked, true, `${field.path} mangler lock`);
    assert.ok(field.lockReason, `${field.path} mangler lockReason`);
  }
});
