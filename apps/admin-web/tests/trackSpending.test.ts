// PR-B2: Track-spending fail-closed regression test.
// REGULATORISK: pengespillforskriften krever at vi ikke misviser admin.
// Sidens must NEVER fetch data OR show fake empty table until BIN-628 lands.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderTrackSpendingPage } from "../src/pages/track-spending/TrackSpendingPage.js";
import {
  fetchTrackSpending,
  NotImplementedError,
} from "../src/api/admin-track-spending.js";

describe("Track-spending — fail-closed regulatorisk stub", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });

  it("renders the regulatory banner with BIN-628 reference", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderTrackSpendingPage(root);
    expect(root.textContent).toMatch(/regulatorisk rapport kommer/i);
    expect(root.innerHTML).toContain("BIN-628");
  });

  it("NEVER fires a fetch when the page mounts (fail-closed)", () => {
    const fetchSpy = vi.fn();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderTrackSpendingPage(root);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("all filter inputs and search button are disabled", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderTrackSpendingPage(root);
    const inputs = root.querySelectorAll<HTMLInputElement>("input, button[type=submit]");
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((el) => expect(el.disabled).toBe(true));
  });

  it("renders empty tbody — no rows shown", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderTrackSpendingPage(root);
    const rows = root.querySelectorAll("tbody tr");
    expect(rows.length).toBe(0);
  });

  it("API stub throws NotImplementedError referencing BIN-628", async () => {
    await expect(fetchTrackSpending({})).rejects.toBeInstanceOf(NotImplementedError);
    try {
      await fetchTrackSpending({});
    } catch (e) {
      expect(e).toBeInstanceOf(NotImplementedError);
      expect((e as NotImplementedError).issue).toBe("BIN-628");
    }
  });
});
