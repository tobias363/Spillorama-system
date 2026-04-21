/**
 * PlayerPrefs tests.
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

describe("PlayerPrefs", () => {
  let storage: InMemoryStorage;
  let prefs: PlayerPrefs;

  beforeEach(() => {
    storage = new InMemoryStorage();
    prefs = new PlayerPrefs(storage);
  });

  describe("Type coercion", () => {
    it('reads boolean "0" as false, "1" as true', () => {
      storage.setItem("spillorama.prefs.soundEnabled", "1");
      expect(prefs.get("soundEnabled", false)).toBe(true);

      storage.setItem("spillorama.prefs.soundEnabled", "0");
      expect(prefs.get("soundEnabled", true)).toBe(false);
    });

    it('reads boolean "true"/"false"', () => {
      storage.setItem("spillorama.prefs.soundEnabled", "true");
      expect(prefs.get("soundEnabled", false)).toBe(true);
    });

    it("returns default on invalid number", () => {
      storage.setItem("spillorama.prefs.markerDesign", "not-a-number");
      expect(prefs.get("markerDesign", 7)).toBe(7);
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

    it("returns default value when key not set", () => {
      expect(prefs.get("volume", 0.5)).toBe(0.5);
      expect(prefs.get("language", "no")).toBe("no");
    });
  });

  describe("Robustness", () => {
    it("does not throw when storage is null", () => {
      const nullPrefs = new PlayerPrefs(null as unknown as Storage);
      expect(nullPrefs.get("volume", 0.5)).toBe(0.5);
      expect(() => nullPrefs.set("volume", 1.0)).not.toThrow();
      expect(nullPrefs.has("volume")).toBe(false);
    });
  });
});
