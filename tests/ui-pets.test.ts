import { describe, it, expect } from "vitest";
import { buildPetsView, createPetsView, type PetSummary } from "@/ui/pets";
import { buildBeepsView, type BeepSummary } from "@/ui/beeps";
import { normalizeSettings, SETTINGS_DEFAULTS } from "@/ui/settings";
import { validSlotLabel } from "@/ui/slots";
import { t } from "@/i18n";

/**
 * Task 11 — the pet list view.
 *
 * The view is split in two: a pure `buildPetsView()` that turns an API payload
 * into rows, and `createPetsView()` that wires selection to the `LiveClient`.
 * That split keeps the list logic testable without a DOM (this project has no
 * jsdom): the render assertions run against the pure builder, and the wiring
 * assertion runs against a fake `live`.
 *
 * The binding rule from the spec (§3/§4) and the task brief: a dead pet shows
 * its age and `diedAt` — **never a cause**, because the ROM cannot expose one.
 */

/** One living and one dead pet, as `GET /api/pets` would return them. */
const PAYLOAD: PetSummary[] = [
  {
    id: "pet-alive",
    device: "p1",
    name: null,
    alive: true,
    ageYears: 3,
    bornAt: "2026-01-01T00:00:00.000Z",
    diedAt: null,
  },
  {
    id: "pet-dead",
    device: "p1",
    name: null,
    alive: false,
    ageYears: 5,
    bornAt: "2025-11-01T00:00:00.000Z",
    diedAt: "2026-02-01T12:00:00.000Z",
  },
];

describe("buildPetsView", () => {
  it("orders the living pet above the dead one", () => {
    const view = buildPetsView(PAYLOAD, "pet-alive");
    expect(view.map((r) => r.id)).toEqual(["pet-alive", "pet-dead"]);
  });

  it("marks the current pet", () => {
    const view = buildPetsView(PAYLOAD, "pet-alive");
    expect(view.find((r) => r.id === "pet-alive")?.current).toBe(true);
    expect(view.find((r) => r.id === "pet-dead")?.current).toBe(false);
  });

  it("shows the age of a dead pet and its death date", () => {
    const dead = buildPetsView(PAYLOAD, "pet-alive").find((r) => r.id === "pet-dead")!;
    // The age (5) is present, and the moment of death is rendered from diedAt.
    expect(dead.ageYears).toBe(5);
    expect(dead.diedAt).toBe("2026-02-01T12:00:00.000Z");
    expect(dead.alive).toBe(false);
  });

  it("never carries a cause of death in any row", () => {
    const view = buildPetsView(PAYLOAD, "pet-alive");
    // No row exposes a cause field...
    for (const row of view) {
      expect("cause" in row).toBe(false);
      expect("causeOfDeath" in row).toBe(false);
      expect("kind" in row).toBe(false);
    }
    // ...and nothing in the serialised view is a cause string.
    expect(JSON.stringify(view)).not.toMatch(/cause/i);
  });

  it("keeps an alive pet's diedAt empty", () => {
    const alive = buildPetsView(PAYLOAD, "pet-alive").find((r) => r.id === "pet-alive")!;
    expect(alive.diedAt).toBeNull();
  });
});

describe("createPetsView selection", () => {
  it("selecting a pet calls LiveClient.connect with its id and the token", () => {
    const calls: Array<{ petId: string; token: string }> = [];
    const live = {
      connect(petId: string, token: string) {
        calls.push({ petId, token });
      },
    };
    const view = createPetsView({ live, token: () => "tok-123" });
    view.select("pet-dead");
    expect(calls).toEqual([{ petId: "pet-dead", token: "tok-123" }]);
  });

  it("does not connect without a token", () => {
    const calls: string[] = [];
    const live = { connect(petId: string) { calls.push(petId); } };
    const view = createPetsView({ live, token: () => null });
    view.select("pet-alive");
    expect(calls).toEqual([]);
  });
});

/** The beep text is generic and identical for every entry — there is no kind. */
describe("buildBeepsView", () => {
  it("uses one generic sentence for every beep", () => {
    const beeps: BeepSummary[] = [
      { id: "b1", petId: "p1", at: "2026-01-02T08:00:00.000Z", notified: false },
      { id: "b2", petId: "p1", at: "2026-01-02T09:00:00.000Z", notified: true },
    ];
    const rows = buildBeepsView(beeps);
    expect(rows).toHaveLength(2);
    // Same text for both — no per-kind wording.
    expect(rows[0].text).toBe(rows[1].text);
    // No cause/kind anywhere in the view model.
    expect(JSON.stringify(rows)).not.toMatch(/cause|kind/i);
  });
});

/** Settings mirror the server's allow-list and never invent keys. */
describe("normalizeSettings", () => {
  it("fills missing keys from the defaults", () => {
    expect(normalizeSettings(null)).toEqual(SETTINGS_DEFAULTS);
    expect(normalizeSettings({ theme: "dark" })).toEqual({ ...SETTINGS_DEFAULTS, theme: "dark" });
  });

  it("drops unknown keys and non-conforming types", () => {
    const s = normalizeSettings({ theme: "dark", hack: "x", sound: "yes" });
    expect(s).toEqual({ ...SETTINGS_DEFAULTS, theme: "dark" });
    expect("hack" in s).toBe(false);
    // A non-boolean sound falls back to the default rather than leaking through.
    expect(s.sound).toBe(true);
  });
});

describe("validSlotLabel", () => {
  it("rejects empty or whitespace-only labels", () => {
    expect(validSlotLabel("")).toBe(false);
    expect(validSlotLabel("   ")).toBe(false);
    expect(validSlotLabel("before boss")).toBe(true);
  });
});

/** Every Task-11 string must exist in de, en and it (no raw-key fallback). */
describe("Task-11 i18n coverage", () => {
  const KEYS = [
    "pets", "petAge", "petAlive", "petDied", "petCurrent", "petLoading", "petEmpty",
    "petNew", "petNewP1", "petNewP2",
    "slots", "slotsEmpty", "slotCreate", "slotLoad", "slotDelete", "slotNamePlaceholder",
    "slotCreated", "slotLoaded", "slotDeleted",
    "settings", "settingsSaved", "settingsFailed",
    "beeps", "beepsEmpty", "beepAt", "beepNotified", "beepNotSent", "beepGeneric",
    "connectionLive", "connectionOffline", "connectionHint", "signInToPlay",
  ];

  for (const lang of ["de", "en", "it"] as const) {
    it(`${lang} has every Task-11 key`, () => {
      const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      // currentLang() reads navigator.language; stub it per language.
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { language: lang === "de" ? "de-DE" : lang === "it" ? "it-IT" : "en-US" },
      });
      try {
        for (const k of KEYS) {
          // A missing key falls back to the key itself (t() contract).
          expect(t(k)).not.toBe(k);
          expect(t(k).length).toBeGreaterThan(0);
        }
      } finally {
        if (saved) Object.defineProperty(globalThis, "navigator", saved);
      }
    });
  }

  it("the beep text is one generic sentence, not per-kind", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
    try {
      // A single key — there is no beepKind1/2/… to differ between events.
      const generic = t("beepGeneric");
      expect(generic.length).toBeGreaterThan(0);
      expect(t("beepKind1")).toBe("beepKind1"); // no such key exists
    } finally {
      if (saved) Object.defineProperty(globalThis, "navigator", saved);
    }
  });
});
