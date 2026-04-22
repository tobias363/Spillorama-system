// PR 4e.1 (2026-04-22) — GroupHallEditorModal DOM-tests.
//
// Coverage:
//   - Create-modus renderer tomt skjema med default status=active
//   - Edit-modus pre-fyller name, tvId, description, status, members
//   - Inaktive medlemmer fra legacy-data stays pre-selected
//   - Form-validering viser feilmelding uten å lukke modalen
//   - Vellykket lagring kaller onSaved og lukker modalen

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { openGroupHallEditorModal } from "../../src/pages/groupHall/GroupHallEditorModal.js";
import type { HallGroupRow } from "../../src/pages/groupHall/GroupHallState.js";
import type { AdminHall } from "../../src/api/admin-halls.js";

const fixtureHalls: AdminHall[] = [
  {
    id: "hall-1",
    slug: "1001",
    name: "Oslo City",
    region: "",
    address: "",
    isActive: true,
    clientVariant: "web",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "hall-2",
    slug: "1002",
    name: "Bergen Brygge",
    region: "",
    address: "",
    isActive: true,
    clientVariant: "web",
    createdAt: "",
    updatedAt: "",
  },
];

const fixtureRow: HallGroupRow = {
  id: "hg-1",
  legacyGroupHallId: null,
  name: "Nord-gruppen",
  status: "active",
  tvId: 7,
  productIds: [],
  members: [
    {
      hallId: "hall-1",
      hallName: "Oslo City",
      hallStatus: "active",
      addedAt: "2026-04-20T12:00:00.000Z",
    },
  ],
  extra: { description: "Pilot-test" },
  createdBy: null,
  createdAt: "",
  updatedAt: "",
};

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchOk(data: unknown): FetchMock {
  const fn: FetchMock = vi.fn((async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  })) as never);
  (globalThis as unknown as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  initI18n();
  window.localStorage.setItem("bingo_admin_access_token", "test-token");
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GroupHallEditorModal — create-modus", () => {
  it("renderer tomt skjema med default status=active", async () => {
    openGroupHallEditorModal({
      mode: "create",
      hallLoader: async () => fixtureHalls,
    });
    await tick();
    const nameInput = document.querySelector<HTMLInputElement>('[data-testid="gh-name"]');
    const statusSelect = document.querySelector<HTMLSelectElement>('[data-testid="gh-status"]');
    const membersSelect = document.querySelector<HTMLSelectElement>('[data-testid="gh-members"]');
    expect(nameInput).toBeTruthy();
    expect(nameInput?.value).toBe("");
    expect(statusSelect?.value).toBe("active");
    // No members selected in create-modus
    expect(Array.from(membersSelect!.options).filter((o) => o.selected)).toHaveLength(0);
    expect(membersSelect!.multiple).toBe(true);
  });
});

describe("GroupHallEditorModal — edit-modus", () => {
  it("pre-fyller name, tvId, description, status, og aktive members", async () => {
    openGroupHallEditorModal({
      mode: "edit",
      existing: fixtureRow,
      hallLoader: async () => fixtureHalls,
    });
    await tick();
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="gh-name"]')!.value
    ).toBe("Nord-gruppen");
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="gh-tvId"]')!.value
    ).toBe("7");
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="gh-description"]')!
        .value
    ).toBe("Pilot-test");
    expect(
      document.querySelector<HTMLSelectElement>('[data-testid="gh-status"]')!.value
    ).toBe("active");
    const selected = Array.from(
      document.querySelector<HTMLSelectElement>('[data-testid="gh-members"]')!.options
    )
      .filter((o) => o.selected)
      .map((o) => o.value);
    expect(selected).toEqual(["hall-1"]);
  });

  it("inkluderer inaktive legacy-members som valgt for å unngå data-tap", async () => {
    const rowWithGhostMember: HallGroupRow = {
      ...fixtureRow,
      members: [
        ...fixtureRow.members,
        {
          hallId: "hall-ghost",
          hallName: "Stavanger Gamle",
          hallStatus: "inactive",
          addedAt: "2026-04-20T12:00:00.000Z",
        },
      ],
    };
    openGroupHallEditorModal({
      mode: "edit",
      existing: rowWithGhostMember,
      // Obs: hallLoader returnerer KUN de aktive hallene
      hallLoader: async () => fixtureHalls,
    });
    await tick();
    const opts = Array.from(
      document.querySelector<HTMLSelectElement>('[data-testid="gh-members"]')!.options
    );
    const ghost = opts.find((o) => o.value === "hall-ghost");
    expect(ghost).toBeTruthy();
    expect(ghost?.selected).toBe(true);
  });

  it("throw hvis edit-modus uten existing", () => {
    expect(() =>
      openGroupHallEditorModal({
        mode: "edit",
        hallLoader: async () => fixtureHalls,
      })
    ).toThrow(/existing/);
  });
});

describe("GroupHallEditorModal — validation + save", () => {
  it("tom name viser feil uten å lukke modalen", async () => {
    const onSaved = vi.fn();
    openGroupHallEditorModal({
      mode: "create",
      hallLoader: async () => fixtureHalls,
      onSaved,
    });
    await tick();
    const saveBtn = document.querySelector<HTMLButtonElement>(
      'button[data-action="gh-modal-save"]'
    )!;
    saveBtn.click();
    await tick();
    const errors = document.querySelector<HTMLElement>(
      '[data-testid="gh-editor-errors"]'
    )!;
    expect(errors.style.display).toBe("block");
    expect(errors.textContent).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    // Modalen er fortsatt åpen
    expect(document.querySelector('[data-testid="gh-editor-form"]')).toBeTruthy();
  });

  it("vellykket create kaller onSaved og lukker modalen", async () => {
    const onSaved = vi.fn();
    mockFetchOk({
      id: "hg-99",
      legacyGroupHallId: null,
      name: "Ny",
      status: "active",
      tvId: null,
      productIds: [],
      members: [],
      extra: {},
      createdBy: null,
      createdAt: "",
      updatedAt: "",
    });
    openGroupHallEditorModal({
      mode: "create",
      hallLoader: async () => fixtureHalls,
      onSaved,
    });
    await tick();
    document.querySelector<HTMLInputElement>('[data-testid="gh-name"]')!.value = "Ny";
    const saveBtn = document.querySelector<HTMLButtonElement>(
      'button[data-action="gh-modal-save"]'
    )!;
    saveBtn.click();
    await tick(20);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0]![0].id).toBe("hg-99");
    // Modalen er lukket
    expect(document.querySelector('[data-testid="gh-editor-form"]')).toBeNull();
  });

  it("ugyldig tvId viser feil (negativ) uten fetch", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: {} }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy as unknown as typeof fetch;
    openGroupHallEditorModal({
      mode: "create",
      hallLoader: async () => fixtureHalls,
    });
    await tick();
    document.querySelector<HTMLInputElement>('[data-testid="gh-name"]')!.value = "x";
    document.querySelector<HTMLInputElement>('[data-testid="gh-tvId"]')!.value = "-5";
    const saveBtn = document.querySelector<HTMLButtonElement>(
      'button[data-action="gh-modal-save"]'
    )!;
    saveBtn.click();
    await tick();
    const errors = document.querySelector<HTMLElement>(
      '[data-testid="gh-editor-errors"]'
    )!;
    expect(errors.style.display).toBe("block");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
