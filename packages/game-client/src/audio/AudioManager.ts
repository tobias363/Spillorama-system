import { Howl, Howler } from "howler";

export type VoiceLanguage = "nb-m" | "nb-f" | "en";

/**
 * Audio manager for bingo number announcements and sound effects.
 * Replaces Unity SoundManager.cs.
 *
 * Handles:
 * - Number announcements in multiple languages (Norwegian male/female, English)
 * - Sound effects (mark, win, draw, etc.)
 * - Mobile audio unlock (user gesture requirement)
 * - Volume control and language selection
 */
export class AudioManager {
  private numberSounds = new Map<string, Howl>();
  private sfxSounds = new Map<string, Howl>();
  private language: VoiceLanguage = "nb-m";
  private volume = 0.8;
  private muted = false;
  private unlocked = false;
  private audioBasePath: string;

  constructor(audioBasePath = "/web/games/audio") {
    this.audioBasePath = audioBasePath;

    // Restore preferences from localStorage
    const savedLang = localStorage.getItem("spillorama.audio.language");
    if (savedLang === "nb-m" || savedLang === "nb-f" || savedLang === "en") {
      this.language = savedLang;
    }
    const savedVol = localStorage.getItem("spillorama.audio.volume");
    if (savedVol !== null) {
      this.volume = Math.max(0, Math.min(1, parseFloat(savedVol) || 0.8));
    }
    const savedMute = localStorage.getItem("spillorama.audio.muted");
    if (savedMute === "true") {
      this.muted = true;
    }

    Howler.volume(this.muted ? 0 : this.volume);
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

  // ── Number announcements ──────────────────────────────────────────────

  /**
   * Play the announcement for a drawn number.
   * Audio files expected at: {basePath}/{language}/{number}.mp3
   */
  playNumber(number: number): void {
    if (this.muted || number < 1 || number > 60) return;

    const key = `${this.language}-${number}`;
    let sound = this.numberSounds.get(key);

    if (!sound) {
      sound = new Howl({
        src: [`${this.audioBasePath}/${this.language}/${number}.mp3`],
        volume: this.volume,
        onloaderror: () => {
          // Silently fail — missing audio file shouldn't break gameplay
        },
      });
      this.numberSounds.set(key, sound);
    }

    sound.volume(this.volume);
    sound.play();
  }

  // ── Sound effects ─────────────────────────────────────────────────────

  /**
   * Play a sound effect.
   * Audio files expected at: {basePath}/sfx/{name}.mp3
   */
  playSfx(name: string): void {
    if (this.muted) return;

    let sound = this.sfxSounds.get(name);

    if (!sound) {
      sound = new Howl({
        src: [`${this.audioBasePath}/sfx/${name}.mp3`],
        volume: this.volume,
        onloaderror: () => {},
      });
      this.sfxSounds.set(name, sound);
    }

    sound.volume(this.volume);
    sound.play();
  }

  // ── Settings ──────────────────────────────────────────────────────────

  setLanguage(lang: VoiceLanguage): void {
    this.language = lang;
    localStorage.setItem("spillorama.audio.language", lang);
  }

  getLanguage(): VoiceLanguage {
    return this.language;
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    Howler.volume(this.muted ? 0 : this.volume);
    localStorage.setItem("spillorama.audio.volume", String(this.volume));
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    Howler.volume(muted ? 0 : this.volume);
    localStorage.setItem("spillorama.audio.muted", String(muted));
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Stop all currently playing sounds (Unity: reset sound announcements on game end).
   */
  stopAll(): void {
    Howler.stop();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  destroy(): void {
    for (const sound of this.numberSounds.values()) sound.unload();
    for (const sound of this.sfxSounds.values()) sound.unload();
    this.numberSounds.clear();
    this.sfxSounds.clear();
  }
}
