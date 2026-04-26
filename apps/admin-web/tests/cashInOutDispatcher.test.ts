/**
 * Cash-in-out dispatcher — sjekker at agent-portal-aliasene ruter til
 * korrekt page-render. Dette er en lett-vekt-test som ikke faktisk mounter
 * sidene (som krever auth-state og DOM); vi sjekker bare at
 * `isCashInOutRoute` matcher rutene vi forventer.
 */
import { describe, it, expect } from "vitest";
import { isCashInOutRoute } from "../src/pages/cash-inout/index.js";

describe("cash-inout dispatcher — agent-portal aliases", () => {
  it("matcher /agent/sold-tickets (wireframe §17.31)", () => {
    expect(isCashInOutRoute("/agent/sold-tickets")).toBe(true);
  });

  it("matcher /sold-tickets (admin-route)", () => {
    expect(isCashInOutRoute("/sold-tickets")).toBe(true);
  });

  it("matcher /agent/sellProduct (wireframe §17.12)", () => {
    expect(isCashInOutRoute("/agent/sellProduct")).toBe(true);
  });

  it("matcher /agent/unique-id/add og /withdraw", () => {
    expect(isCashInOutRoute("/agent/unique-id/add")).toBe(true);
    expect(isCashInOutRoute("/agent/unique-id/withdraw")).toBe(true);
  });

  it("matcher /agent/register-user/add og /withdraw", () => {
    expect(isCashInOutRoute("/agent/register-user/add")).toBe(true);
    expect(isCashInOutRoute("/agent/register-user/withdraw")).toBe(true);
  });

  it("matcher /agent/cashinout (legacy hovedside)", () => {
    expect(isCashInOutRoute("/agent/cashinout")).toBe(true);
  });

  it("matcher ikke /agent/dashboard eller andre fritt-stående ruter", () => {
    expect(isCashInOutRoute("/agent/dashboard")).toBe(false);
    expect(isCashInOutRoute("/agent/unique-id")).toBe(false);
    expect(isCashInOutRoute("/admin")).toBe(false);
  });
});
