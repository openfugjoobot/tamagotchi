import { describe, it, expect, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApi, type ApiRepo } from "../server/src/api";
import type { TokenClaims } from "../server/src/auth";
import type { BeepRow, Device, PetRow, UserRow } from "../server/src/db/repo";
import { createSettingsView } from "@/ui/settings";
import { createAppearanceHandlers } from "@/ui/appearance";
import { THEME_IDS } from "@/theme";
import { SHELLS } from "@/shell";

/**
 * Fix A2b (Task-11 D2) — theme/shell round-trip **from a UI event**.
 *
 * The deferral this closes: the settings allow-list already mirrored the real UI
 * ids, but the UI never *wrote* theme/shell back, so they only lived in
 * localStorage and never synced across devices (spec §3). This test drives the
 * real `createAppearanceHandlers` (the exact handlers `src/main.ts` wires to the
 * theme grid, the shell grid and the shell carousel) through `createSettingsView`
 * straight into the **real** `/api/settings` route, then reads it back.
 *
 * It fails against the pre-fix code: without a persistence call the selection
 * never reaches the server, so the read-back returns the default.
 */

const CLIENT = "1234.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const GOOD = "good-token";
const SUB = "google-sub-1";

/** Minimal in-memory `ApiRepo`: only `/api/settings` is exercised, but every
 * method is implemented so the structural `ApiRepo` contract is satisfied. */
class FakeRepo implements ApiRepo {
  users = new Map<string, UserRow>();
  pets: PetRow[] = [];
  private seq = 0;

  async upsertUser(p: { sub: string; email?: string | null; name?: string | null; picture?: string | null }): Promise<UserRow> {
    for (const u of this.users.values()) {
      if (u.google_sub === p.sub) return u;
    }
    const row: UserRow = {
      id: `user-${++this.seq}`,
      google_sub: p.sub,
      email: p.email ?? null,
      name: p.name ?? null,
      picture: p.picture ?? null,
      settings: {},
      created_at: new Date(NOW),
      last_seen_at: new Date(NOW),
    };
    this.users.set(row.id, row);
    return row;
  }
  async listPets(userId: string): Promise<PetRow[]> { return this.pets.filter((p) => p.user_id === userId); }
  async getPet(userId: string, petId: string): Promise<PetRow | null> {
    return this.pets.find((p) => p.id === petId && p.user_id === userId) ?? null;
  }
  async createPet(userId: string, device: Device): Promise<PetRow> {
    const row: PetRow = {
      id: `pet-${++this.seq}`, user_id: userId, device, rom_ver: "1.0", name: null,
      state: null, state_ver: 1, born_at: new Date(NOW), age_years: 0, alive: true,
      died_at: null, last_tick_at: new Date(NOW), updated_at: new Date(NOW),
    };
    this.pets.push(row);
    return row;
  }
  async createSlot(): Promise<{ id: string; label: string; device: string; age_years: number; created_at: Date }> {
    throw new Error("not used by /api/settings");
  }
  async listSlots(): Promise<Array<{ id: string; label: string; device: string; age_years: number; created_at: Date }>> {
    return [];
  }
  async getSlot(): Promise<unknown> { return null; }
  async deleteSlot(): Promise<void> { /* unused */ }
  async getSettings(userId: string): Promise<Record<string, unknown>> { return this.users.get(userId)?.settings ?? {}; }
  async setSettings(userId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    const u = this.users.get(userId);
    if (!u) return {};
    u.settings = settings;
    return settings;
  }
  async addPushSub(): Promise<unknown> { return {}; }
  async removePushSub(): Promise<void> { /* unused */ }
  async listBeeps(): Promise<BeepRow[]> { return []; }
}

async function verify(token: string): Promise<TokenClaims> {
  if (token !== GOOD) throw new Error("bad token");
  return { sub: SUB, aud: CLIENT, iss: "https://accounts.google.com", exp: Math.floor(NOW / 1000) + 3600, email: "ivan@example.com", name: "Ivan" };
}

function build(repo: FakeRepo): FastifyInstance {
  const app = Fastify();
  registerApi(app, { repo, verify, clientId: CLIENT, startPet: () => {} });
  return app;
}

/**
 * Route `fetch` through the Fastify instance so the *unmodified* settings view
 * (which calls the global `fetch`) hits the real routes without a network.
 */
function stubFetch(app: FastifyInstance): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    const res = await app.inject({
      method: (init?.method as "GET" | "PUT" | "POST" | "DELETE") ?? "GET",
      url,
      headers: { authorization: headers.get("authorization") ?? undefined },
      payload: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(res.body, { status: res.statusCode, headers: { "content-type": res.headers["content-type"] ?? "application/json" } });
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("theme/shell round-trip from a UI selection (Fix A2b)", () => {
  it("persists a theme picked in the UI and reads it back from the server", async () => {
    const repo = new FakeRepo();
    const app = build(repo);
    stubFetch(app);

    const view = createSettingsView({ token: () => GOOD });
    // A live handler wired exactly like the app: persist → settingsView.save.
    const handlers = createAppearanceHandlers({ persist: (p) => void view.save(p), isApplying: () => false });

    const theme = THEME_IDS.find((id) => id !== "auto")!;
    handlers.selectTheme(theme); // the UI event
    await vi.waitFor(async () => {
      const back = await view.load();
      expect(back.theme).toBe(theme);
    });
  });

  it("persists a shell picked in the UI and reads it back from the server", async () => {
    const repo = new FakeRepo();
    const app = build(repo);
    stubFetch(app);

    const view = createSettingsView({ token: () => GOOD });
    const handlers = createAppearanceHandlers({ persist: (p) => void view.save(p), isApplying: () => false });

    const shell = SHELLS[2].id;
    handlers.selectShell(shell);
    await vi.waitFor(async () => {
      const back = await view.load();
      expect(back.shell).toBe(shell);
    });
  });

  it("does not write back a value the server just applied (loop guard)", async () => {
    const repo = new FakeRepo();
    const app = build(repo);
    stubFetch(app);

    const saved: Array<Partial<{ theme: string; shell: string }>> = [];
    const handlers = createAppearanceHandlers({ persist: (p) => saved.push(p), isApplying: () => true });

    handlers.selectTheme("night");
    handlers.selectShell("teal");
    expect(saved).toHaveLength(0);
  });
});
