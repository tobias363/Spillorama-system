/**
 * BIN-544: Typed localStorage wrapper with Unity PlayerPrefs key migration.
 *
 * "unity.player_prefs.MarkerDesign" or plain "Game_Marker". This class reads
 * existing Unity keys on first access and copies them to our namespaced
 * "spillorama.prefs.*" keys — so users who migrate from Unity to web keep
 * their audio, language, marker and notification settings.
 * `PlayerPrefs\.(GetString|GetInt|GetFloat|SetString|...)` calls.
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
  /** Double-announce toggle (web-native only, no Unity equivalent). */
  doubleAnnounce: boolean;
}

/**
 *
 * Each entry lists all Unity key-name variants observed in the legacy
 * codebase. The migrator tries them in order and copies the first hit to
 * the namespaced web key.
 */
const UNITY_KEY_MAP: Partial<Record<keyof PrefsSchema, string[]>> = {
  markerDesign: ["Game_Marker", "MarkerDesign", "Marker_Design"],
  background: ["Game_Background"],
  language: ["CurrentGameLanguage", "Language", "SelectedLanguage"],
  volume: ["Volume", "SoundVolume", "MasterVolume"],
  voiceGender: ["VoiceStatus", "VOICE_STATUS", "VoiceGender", "SoundGender"],
  soundEnabled: ["SoundStatus", "SOUND_STATUS", "SoundEnabled", "IsSoundOn"],
  notificationsEnabled: ["NotificationsEnabled"],
};

/**
 * at least these prefixes depending on version + configuration.
 */
const UNITY_PREFIXES = ["", "unity.player_prefs.", "PlayerPrefs."];

/**
 * Secondary write-targets during migration. `AudioManager` was written before
 * `PlayerPrefs` existed and uses its own legacy localStorage keys. When we
 * migrate a Unity value into the new namespaced key, we ALSO copy it into
 * the AudioManager legacy keys so AudioManager picks it up on next init
 * without needing to be refactored.
 *
 * Value-mapping handles boolean normalization ("0"/"1" → "true"/"false")
 * and voice-gender normalization.
 */
const LEGACY_AUDIOMANAGER_TARGETS: Partial<
  Record<keyof PrefsSchema, { key: string; transform?: (raw: string) => string }>
> = {
  soundEnabled: {
    key: "spillorama-sound-enabled",
    transform: (raw) => (raw === "1" || raw === "true" ? "true" : "false"),
  },
  voiceEnabled: {
    key: "spillorama-voice-enabled",
    transform: (raw) => (raw === "1" || raw === "true" ? "true" : "false"),
  },
  voiceGender: {
    key: "spillorama-voice-lang",
    transform: (raw) => {
      const lower = raw.toLowerCase();
      if (lower === "male" || lower === "no-male") return "no-male";
      if (lower === "female" || lower === "no-female") return "no-female";
      if (lower === "en" || lower === "english") return "en";
      return raw;
    },
  },
};

export class PlayerPrefs {
  private migrated = false;
  private readonly storage: Storage;

  constructor(
    storage: Storage = typeof localStorage !== "undefined"
      ? localStorage
      : (null as unknown as Storage),
  ) {
    this.storage = storage;
  }

  /**
   * Copy Unity PlayerPrefs values to our namespaced keys on first access.
   * Idempotent — subsequent calls are no-ops. Also skips keys where a web
   * value already exists (user-modified web prefs must not be overwritten
   * by stale Unity values).
   */
  private migrateFromUnity(): void {
    if (this.migrated) return;
    this.migrated = true;
    if (!this.storage) return;

    let migratedCount = 0;
    for (const [webKey, unityKeys] of Object.entries(UNITY_KEY_MAP)) {
      const fullWebKey = PREFIX + webKey;
      if (this.storage.getItem(fullWebKey) !== null) continue;

      outer: for (const unityKey of unityKeys ?? []) {
        for (const prefix of UNITY_PREFIXES) {
          const val = this.storage.getItem(prefix + unityKey);
          if (val !== null) {
            this.storage.setItem(fullWebKey, val);
            migratedCount++;

            // Also populate AudioManager's legacy keys if this web-key has
            // a secondary target. Skip if a value already exists at the
            // legacy key (web user may have already configured audio).
            const legacyTarget = LEGACY_AUDIOMANAGER_TARGETS[webKey as keyof PrefsSchema];
            if (legacyTarget && this.storage.getItem(legacyTarget.key) === null) {
              const transformed = legacyTarget.transform ? legacyTarget.transform(val) : val;
              this.storage.setItem(legacyTarget.key, transformed);
            }
            break outer;
          }
        }
      }
    }

    if (migratedCount > 0) {
      this.storage.setItem(PREFIX + "_migration.unity.completedAt", String(Date.now()));
      this.storage.setItem(PREFIX + "_migration.unity.keysMigrated", String(migratedCount));
    }
  }

  get<K extends keyof PrefsSchema>(key: K, defaultValue: PrefsSchema[K]): PrefsSchema[K] {
    this.migrateFromUnity();
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
    this.migrateFromUnity();
    if (!this.storage) return false;
    return this.storage.getItem(PREFIX + key) !== null;
  }

  /** Diagnostics: returns migration-state for support/debugging. */
  getMigrationInfo(): { completedAt: number | null; keysMigrated: number } {
    if (!this.storage) return { completedAt: null, keysMigrated: 0 };
    const at = this.storage.getItem(PREFIX + "_migration.unity.completedAt");
    const count = this.storage.getItem(PREFIX + "_migration.unity.keysMigrated");
    return {
      completedAt: at === null ? null : Number(at),
      keysMigrated: count === null ? 0 : Number(count),
    };
  }
}

/** Shared singleton for convenience. */
export const playerPrefs = new PlayerPrefs();
