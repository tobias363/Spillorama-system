/**
 * BIN-544: PlayerPrefs migration tests.
 *
 * Verifies:
 *  - Unity keys are migrated on first access (all prefix variants)
 *  - Web-side values are NOT overwritten if they already exist
 *  - Boolean/number coercion handles Unity's "0"/"1" and "true"/"false"
 *  - Voice-gender normalization (Unity "Male" → web "no-male")
 *  - AudioManager legacy keys are populated as secondary migration target
 *  - Migration info is recorded for support/debugging
 *  - Missing storage (SSR/test env without localStorage) does not throw
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PlayerPrefs } from "./PlayerPrefs.js";

class InMemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null {
    const keys = Array.from(this.map.keys());
    return keys[index] ?? null;
  }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

describe("BIN-544: PlayerPrefs", () => {
  let storage: InMemoryStorage;
  let prefs: PlayerPrefs;

  beforeEach(() => {
    storage = new InMemoryStorage();
    prefs = new PlayerPrefs(storage);
  });

  describe("Unity migration", () => {
    it("migrates plain Unity key (no prefix)", () => {
      storage.setItem("Game_Marker", "3");
      expect(prefs.get("markerDesign", 0)).toBe(3);
      expect(storage.getItem("spillorama.prefs.markerDesign")).toBe("3");
    });

    it("migrates unity.player_prefs. prefix", () => {
      storage.setItem("unity.player_prefs.CurrentGameLanguage", "en");
      expect(prefs.get("language", "no")).toBe("en");
    });

    it("migrates PlayerPrefs. prefix", () => {
      storage.setItem("PlayerPrefs.NotificationsEnabled", "1");
      expect(prefs.get("notificationsEnabled", false)).toBe(true);
    });

    it("tries Unity variants in order; first match wins", () => {
      // Game_Marker is tried before MarkerDesign; if both present, Game_Marker wins
      storage.setItem("Game_Marker", "2");
      storage.setItem("MarkerDesign", "7");
      expect(prefs.get("markerDesign", 0)).toBe(2);
    });

    it("does not overwrite existing web value", () => {
      storage.setItem("spillorama.prefs.volume", "0.5");
      storage.setItem("Volume", "0.9");
      expect(prefs.get("volume", 1.0)).toBe(0.5);
    });

    it("is idempotent — second access does not re-migrate", () => {
      storage.setItem("Game_Marker", "5");
      prefs.get("markerDesign", 0);
      // Change Unity key after first migration; should not affect second access
      storage.setItem("Game_Marker", "99");
      expect(prefs.get("markerDesign", 0)).toBe(5);
    });

    it("migration info records completedAt + keysMigrated", () => {
      storage.setItem("Game_Marker", "1");
      storage.setItem("SoundStatus", "0");
      prefs.get("markerDesign", 0); // triggers migration
      const info = prefs.getMigrationInfo();
      expect(info.keysMigrated).toBe(2);
      expect(info.completedAt).toBeGreaterThan(0);
    });
  });

  describe("Type coercion", () => {
    it('reads boolean "0" as false, "1" as true (Unity format)', () => {
      storage.setItem("SoundStatus", "1");
      expect(prefs.get("soundEnabled", false)).toBe(true);

      const storage2 = new InMemoryStorage();
      storage2.setItem("SoundStatus", "0");
      const prefs2 = new PlayerPrefs(storage2);
      expect(prefs2.get("soundEnabled", true)).toBe(false);
    });

    it('reads boolean "true"/"false" (web format)', () => {
      storage.setItem("spillorama.prefs.soundEnabled", "true");
      expect(prefs.get("soundEnabled", false)).toBe(true);
    });

    it("returns default on invalid number", () => {
      storage.setItem("spillorama.prefs.markerDesign", "not-a-number");
      expect(prefs.get("markerDesign", 7)).toBe(7);
    });
  });

  describe("AudioManager legacy bridge", () => {
    it("populates spillorama-sound-enabled from Unity SoundStatus", () => {
      storage.setItem("SoundStatus", "1");
      prefs.get("soundEnabled", false); // trigger migration
      expect(storage.getItem("spillorama-sound-enabled")).toBe("true");
    });

    it("normalizes Unity voice-gender Male/Female to no-male/no-female", () => {
      storage.setItem("VoiceStatus", "Female");
      prefs.get("voiceGender", "no-male");
      expect(storage.getItem("spillorama-voice-lang")).toBe("no-female");
    });

    it("does not overwrite existing AudioManager legacy key", () => {
      storage.setItem("spillorama-voice-lang", "en");
      storage.setItem("VoiceStatus", "Male");
      prefs.get("voiceGender", "no-male");
      expect(storage.getItem("spillorama-voice-lang")).toBe("en");
    });
  });

  describe("CRUD", () => {
    it("set/get round-trip for number", () => {
      prefs.set("volume", 0.75);
      expect(prefs.get("volume", 0)).toBe(0.75);
    });

    it("set/get round-trip for boolean", () => {
      prefs.set("doubleAnnounce", true);
      expect(prefs.get("doubleAnnounce", false)).toBe(true);
    });

    it("has() returns true after set, false after delete", () => {
      prefs.set("language", "en");
      expect(prefs.has("language")).toBe(true);
      prefs.delete("language");
      expect(prefs.has("language")).toBe(false);
    });
  });

  describe("Robustness", () => {
    it("does not throw when storage is null", () => {
      const nullPrefs = new PlayerPrefs(null as unknown as Storage);
      expect(nullPrefs.get("volume", 0.5)).toBe(0.5);
      expect(() => nullPrefs.set("volume", 1.0)).not.toThrow();
      expect(nullPrefs.has("volume")).toBe(false);
      expect(nullPrefs.getMigrationInfo().keysMigrated).toBe(0);
    });
  });
});
