/**
 * Typed localStorage wrapper for player preferences.
 *
 * All keys are namespaced under `spillorama.prefs.*` so the app never
 * collides with other tenants of the origin's localStorage.
 */

const PREFIX = "spillorama.prefs.";

/** Known preference keys with their types. */
export interface PrefsSchema {
  /** Marker-design index. */
  markerDesign: number;
  /** Game background style. */
  background: number;
  /** Language code, e.g. "no", "en". */
  language: string;
  /** Master volume 0.0–1.0. */
  volume: number;
  /** Voice-pack code, e.g. "no-male", "no-female", "en". */
  voiceGender: string;
  /** Sound effects on/off. */
  soundEnabled: boolean;
  /** Voice announcements on/off. */
  voiceEnabled: boolean;
  /** Notifications toggle. */
  notificationsEnabled: boolean;
  /** Double-announce toggle. */
  doubleAnnounce: boolean;
}

export class PlayerPrefs {
  private readonly storage: Storage;

  constructor(
    storage: Storage = typeof localStorage !== "undefined"
      ? localStorage
      : (null as unknown as Storage),
  ) {
    this.storage = storage;
  }

  get<K extends keyof PrefsSchema>(key: K, defaultValue: PrefsSchema[K]): PrefsSchema[K] {
    if (!this.storage) return defaultValue;
    const raw = this.storage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;

    if (typeof defaultValue === "boolean") {
      return (raw === "1" || raw === "true") as PrefsSchema[K];
    }
    if (typeof defaultValue === "number") {
      const n = Number(raw);
      return (Number.isFinite(n) ? n : defaultValue) as PrefsSchema[K];
    }
    return raw as PrefsSchema[K];
  }

  set<K extends keyof PrefsSchema>(key: K, value: PrefsSchema[K]): void {
    if (!this.storage) return;
    this.storage.setItem(PREFIX + key, String(value));
  }

  delete<K extends keyof PrefsSchema>(key: K): void {
    if (!this.storage) return;
    this.storage.removeItem(PREFIX + key);
  }

  has<K extends keyof PrefsSchema>(key: K): boolean {
    if (!this.storage) return false;
    return this.storage.getItem(PREFIX + key) !== null;
  }
}

/** Shared singleton for convenience. */
export const playerPrefs = new PlayerPrefs();
