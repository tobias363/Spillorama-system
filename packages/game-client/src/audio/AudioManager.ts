import { Howl, Howler } from "howler";

export type VoiceLanguage = "no-male" | "no-female" | "en";

/**
 * SFX names that can be played via playSfx().
 * Maps to files in the sfx/ directory.
 */
export type SfxName = "mark" | "click" | "notification" | "bingo";

/** Map from SFX name to file info (name + extension). */
const SFX_FILES: Record<SfxName, { file: string }> = {
  mark: { file: "mark.wav" },
  click: { file: "click.wav" },
  notification: { file: "notification.wav" },
  bingo: { file: "bingo.ogg" },
};

/**
 * Map from SettingsPanel voice language values to AudioManager VoiceLanguage.
 * SettingsPanel uses "nor-male" | "nor-female" | "english", but the audio
 * directory structure uses "no-male" | "no-female" | "en".
 */
const SETTINGS_TO_VOICE: Record<string, VoiceLanguage> = {
  "nor-male": "no-male",
  "nor-female": "no-female",
  "english": "en",
};

const VOICE_TO_SETTINGS: Record<VoiceLanguage, string> = {
  "no-male": "nor-male",
  "no-female": "nor-female",
  "en": "english",
};

// localStorage keys
const LS_SOUND_ENABLED = "spillorama-sound-enabled";
const LS_VOICE_ENABLED = "spillorama-voice-enabled";
const LS_VOICE_LANG = "spillorama-voice-lang";

/**
 * Audio manager for bingo number announcements and sound effects.
 * Replaces Unity SoundManager.cs.
 *
 * Handles:
 * - Number announcements in multiple languages (Norwegian male/female, English)
 * - Double-announce mode (Unity callTwoTime — plays number twice)
 * - Sound effects (mark, click, notification, bingo)
 * - BINGO celebration sequencing (waits for voice → 1s pause → bingo SFX)
 * - Separate voice/SFX mute controls
 * - Mobile audio unlock (user gesture requirement)
 * - On-demand number audio loading with caching
 * - SFX preloading
 */
export class AudioManager {
  private numberSounds = new Map<string, Howl>();
  private sfxSounds = new Map<SfxName, Howl>();
  private voiceLanguage: VoiceLanguage = "no-male";
  private soundEnabled = true;
  private voiceEnabled = true;
  private doubleAnnounce = false;
  private unlocked = false;
  private audioBasePath: string;

  /** Numbers announced this round — prevents duplicate announcements. */
  private announcedNumbers = new Set<number>();

  /** Currently playing number announcement Howl (for sequencing). */
  private currentNumberSound: Howl | null = null;

  /** Pending timeout IDs for cleanup. */
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

  constructor(audioBasePath = "/web/games/assets/game1/audio") {
    this.audioBasePath = audioBasePath;

    // Restore voice language from localStorage
    const savedLang = localStorage.getItem(LS_VOICE_LANG);
    if (savedLang === "no-male" || savedLang === "no-female" || savedLang === "en") {
      this.voiceLanguage = savedLang;
    }

    // Restore sound enabled
    const savedSound = localStorage.getItem(LS_SOUND_ENABLED);
    if (savedSound === "false") {
      this.soundEnabled = false;
    }

    // Restore voice enabled
    const savedVoice = localStorage.getItem(LS_VOICE_ENABLED);
    if (savedVoice === "false") {
      this.voiceEnabled = false;
    }

    // Apply master mute
    Howler.volume(this.soundEnabled ? 1.0 : 0);

    // Preload SFX files (small files, safe to preload)
    this.preloadSfx();
  }

  // ── Mobile unlock ─────────────────────────────────────────────────────

  /**
   * Must be called from a user gesture (click/tap) to unlock audio on mobile.
   * iOS Safari and Android Chrome require this before any audio can play.
   */
  unlock(): void {
    if (this.unlocked) return;

    // Create a silent buffer and play it to unlock the audio context
    const silentSound = new Howl({
      src: ["data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="],
      volume: 0,
      onend: () => {
        this.unlocked = true;
        silentSound.unload();
      },
    });
    silentSound.play();
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  // ── Voice language ────────────────────────────────────────────────────

  /**
   * Set the voice pack language for number announcements.
   * Persisted in localStorage.
   */
  setVoiceLanguage(lang: VoiceLanguage): void {
    this.voiceLanguage = lang;
    localStorage.setItem(LS_VOICE_LANG, lang);
  }

  getVoiceLanguage(): VoiceLanguage {
    return this.voiceLanguage;
  }

  /**
   * Convert a SettingsPanel language value to AudioManager VoiceLanguage.
   * SettingsPanel uses "nor-male" | "nor-female" | "english".
   */
  static settingsToVoice(settingsLang: string): VoiceLanguage {
    return SETTINGS_TO_VOICE[settingsLang] ?? "no-male";
  }

  /**
   * Convert AudioManager VoiceLanguage to SettingsPanel value.
   */
  static voiceToSettings(voice: VoiceLanguage): string {
    return VOICE_TO_SETTINGS[voice] ?? "nor-male";
  }

  // ── Number announcements ──────────────────────────────────────────────

  /**
   * Play the announcement for a drawn number.
   * Audio files: {basePath}/{voiceLanguage}/{number}.ogg
   *
   * Tracks announced numbers to prevent duplicate announcements per round.
   * In double-announce mode, plays the number twice (second at lower volume).
   */
  playNumber(number: number): void {
    if (!this.soundEnabled || !this.voiceEnabled) return;
    if (number < 1 || number > 60) return;

    // Prevent duplicate announcement in same round
    if (this.announcedNumbers.has(number)) return;
    this.announcedNumbers.add(number);

    this.playNumberInternal(number, 1.0).then((sound) => {
      if (this.doubleAnnounce && sound) {
        // Wait for first to finish + 0.3s gap, then play at 0.6 volume
        const onEnd = () => {
          const tid = setTimeout(() => {
            this.removePendingTimeout(tid);
            this.playNumberInternal(number, 0.6);
          }, 300);
          this.pendingTimeouts.push(tid);
        };
        // If sound is already finished by the time we attach, play immediately
        if (!sound.playing()) {
          onEnd();
        } else {
          sound.once("end", onEnd);
        }
      }
    });
  }

  /**
   * Internal: load (or retrieve from cache) and play a number sound.
   * Returns the Howl instance or null if load fails.
   */
  private playNumberInternal(number: number, volume: number): Promise<Howl | null> {
    const key = `${this.voiceLanguage}-${number}`;
    let sound = this.numberSounds.get(key);

    if (sound) {
      sound.volume(volume);
      sound.play();
      this.currentNumberSound = sound;
      return Promise.resolve(sound);
    }

    // Load on demand
    return new Promise<Howl | null>((resolve) => {
      const newSound = new Howl({
        src: [`${this.audioBasePath}/${this.voiceLanguage}/${number}.ogg`],
        volume,
        preload: true,
        onload: () => {
          this.numberSounds.set(key, newSound);
          newSound.play();
          this.currentNumberSound = newSound;
          resolve(newSound);
        },
        onloaderror: () => {
          // Silently fail — missing audio file shouldn't break gameplay
          resolve(null);
        },
      });
    });
  }

  /**
   * Reset the set of announced numbers.
   * Call at game start and game end.
   */
  resetAnnouncedNumbers(): void {
    this.announcedNumbers.clear();
  }

  // ── Double announce ───────────────────────────────────────────────────

  /**
   * Enable/disable double-announce mode (Unity callTwoTime).
   * When enabled, each number announcement plays twice —
   * second play at 0.6 volume after a 0.3s gap.
   */
  setDoubleAnnounce(enabled: boolean): void {
    this.doubleAnnounce = enabled;
  }

  isDoubleAnnounce(): boolean {
    return this.doubleAnnounce;
  }

  // ── BINGO celebration ─────────────────────────────────────────────────

  /**
   * Play the BINGO celebration sound with Unity sequencing:
   * 1. Wait for any playing number announcement to finish
   * 2. Wait 1.0s pause
   * 3. Play sfx/bingo.ogg
   */
  playBingoSound(): void {
    if (!this.soundEnabled) return;

    const playBingo = () => {
      const tid = setTimeout(() => {
        this.removePendingTimeout(tid);
        this.playSfxInternal("bingo");
      }, 1000);
      this.pendingTimeouts.push(tid);
    };

    // Check if a number announcement is currently playing
    if (this.currentNumberSound && this.currentNumberSound.playing()) {
      this.currentNumberSound.once("end", playBingo);
    } else {
      playBingo();
    }
  }

  // ── SFX ───────────────────────────────────────────────────────────────

  /**
   * Play a named sound effect.
   * SFX are preloaded on init.
   */
  playSfx(name: SfxName): void {
    if (!this.soundEnabled) return;
    this.playSfxInternal(name);
  }

  private playSfxInternal(name: SfxName): void {
    const sound = this.sfxSounds.get(name);
    if (sound) {
      sound.volume(1.0);
      sound.play();
    }
  }

  private preloadSfx(): void {
    for (const [name, info] of Object.entries(SFX_FILES) as [SfxName, { file: string }][]) {
      const sound = new Howl({
        src: [`${this.audioBasePath}/sfx/${info.file}`],
        preload: true,
        onloaderror: () => {
          // Silently fail — missing SFX shouldn't break gameplay
        },
      });
      this.sfxSounds.set(name, sound);
    }
  }

  // ── Master sound on/off ───────────────────────────────────────────────

  /**
   * Master mute — disables all audio (voice + SFX).
   * Persisted in localStorage.
   */
  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    Howler.volume(enabled ? 1.0 : 0);
    localStorage.setItem(LS_SOUND_ENABLED, String(enabled));
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  // ── Voice on/off (separate from SFX) ──────────────────────────────────

  /**
   * Mute just voice announcements. SFX still play.
   * Persisted in localStorage.
   */
  setVoiceEnabled(enabled: boolean): void {
    this.voiceEnabled = enabled;
    localStorage.setItem(LS_VOICE_ENABLED, String(enabled));
  }

  isVoiceEnabled(): boolean {
    return this.voiceEnabled;
  }

  // ── Stop all ──────────────────────────────────────────────────────────

  /**
   * Stop all currently playing sounds and cancel pending timeouts.
   * Unity: reset sound announcements on game end.
   */
  stopAll(): void {
    // Cancel pending double-announce and bingo timeouts
    for (const tid of this.pendingTimeouts) clearTimeout(tid);
    this.pendingTimeouts = [];
    this.currentNumberSound = null;
    Howler.stop();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  destroy(): void {
    this.stopAll();
    for (const sound of this.numberSounds.values()) sound.unload();
    for (const sound of this.sfxSounds.values()) sound.unload();
    this.numberSounds.clear();
    this.sfxSounds.clear();
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private removePendingTimeout(tid: ReturnType<typeof setTimeout>): void {
    const idx = this.pendingTimeouts.indexOf(tid);
    if (idx !== -1) this.pendingTimeouts.splice(idx, 1);
  }
}
