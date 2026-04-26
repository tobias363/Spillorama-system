/**
 * Player settings panel — matches Unity's SettingPanel Game 1 options.
 *
 * Settings:
 * - Voice on/off (isVoiceOn)
 * - Voice language (Norwegian male / Norwegian female / English)
 * - Lucky number auto-select toggle
 *
 * All settings persisted in localStorage.
 */

const STORAGE_KEY = "spillorama_game1_settings";

export interface Game1Settings {
  soundEnabled: boolean;
  voiceEnabled: boolean;
  voiceLanguage: "nor-male" | "nor-female" | "english";
  luckyAutoSelect: boolean;
  luckyNumber: number | null;
  /** Unity: double-announce mode — repeat each drawn number at lower volume. */
  doubleAnnounce: boolean;
}

const DEFAULTS: Game1Settings = {
  soundEnabled: true,
  voiceEnabled: true,
  voiceLanguage: "nor-male",
  luckyAutoSelect: false,
  luckyNumber: null,
  doubleAnnounce: false,
};

export function loadSettings(): Game1Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveSettings(settings: Game1Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export class SettingsPanel {
  private backdrop: HTMLDivElement;
  private settings: Game1Settings;
  private onChange: ((settings: Game1Settings) => void) | null = null;

  constructor(container: HTMLElement) {
    this.settings = loadSettings();

    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.9)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "70",
      pointerEvents: "auto",
    });
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide();
    });
    container.appendChild(this.backdrop);

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "linear-gradient(180deg, #2a1a0a 0%, #1a0a00 100%)",
      border: "2px solid rgba(255,200,100,0.3)",
      borderRadius: "16px",
      padding: "24px",
      maxWidth: "400px",
      width: "90%",
    });
    this.backdrop.appendChild(panel);

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;";
    const title = document.createElement("h3");
    title.textContent = "Innstillinger";
    title.style.cssText = "color:#ffe83d;font-size:20px;font-weight:700;margin:0;";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk innstillinger");
    closeBtn.title = "Lukk";
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:32px;height:32px;color:#fff;font-size:16px;cursor:pointer;font-family:inherit;";
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Sound on/off (master mute) toggle
    panel.appendChild(this.createToggle("Lyd", this.settings.soundEnabled, (on) => {
      this.settings.soundEnabled = on;
      this.save();
    }));

    // Voice on/off toggle
    panel.appendChild(this.createToggle("Lydannonsering", this.settings.voiceEnabled, (on) => {
      this.settings.voiceEnabled = on;
      this.save();
    }));

    // Voice language selector
    panel.appendChild(this.createSelect("Stemme", [
      { value: "nor-male", label: "Norsk mann" },
      { value: "nor-female", label: "Norsk kvinne" },
      { value: "english", label: "English" },
    ], this.settings.voiceLanguage, (val) => {
      this.settings.voiceLanguage = val as Game1Settings["voiceLanguage"];
      this.save();
    }));

    // Lucky number auto-select
    panel.appendChild(this.createToggle("Auto-velg heldig tall", this.settings.luckyAutoSelect, (on) => {
      this.settings.luckyAutoSelect = on;
      this.save();
    }));

    // Double announce — repeat drawn numbers
    panel.appendChild(this.createToggle("Gjenta tall", this.settings.doubleAnnounce, (on) => {
      this.settings.doubleAnnounce = on;
      this.save();
    }));
  }

  setOnChange(callback: (settings: Game1Settings) => void): void {
    this.onChange = callback;
  }

  show(): void {
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  getSettings(): Game1Settings {
    return { ...this.settings };
  }

  destroy(): void {
    this.backdrop.remove();
  }

  private save(): void {
    saveSettings(this.settings);
    this.onChange?.(this.settings);
  }

  private createToggle(label: string, initialValue: boolean, onChange: (on: boolean) => void): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);";

    const lbl = document.createElement("span");
    lbl.textContent = label;
    lbl.style.cssText = "color:#ddd;font-size:15px;";
    row.appendChild(lbl);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    let on = initialValue;
    const updateToggle = () => {
      toggle.textContent = on ? "På" : "Av";
      toggle.setAttribute("aria-checked", String(on));
      toggle.setAttribute("aria-label", `${label}: ${on ? "På" : "Av"}`);
      toggle.style.background = on ? "rgba(46,125,50,0.6)" : "rgba(100,100,100,0.4)";
      toggle.style.color = on ? "#81c784" : "#999";
    };
    toggle.style.cssText = "border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;min-width:55px;text-align:center;";
    updateToggle();
    toggle.addEventListener("click", () => {
      on = !on;
      updateToggle();
      onChange(on);
    });
    row.appendChild(toggle);
    return row;
  }

  private createSelect(label: string, options: { value: string; label: string }[], initialValue: string, onChange: (val: string) => void): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);";

    const lbl = document.createElement("span");
    lbl.textContent = label;
    lbl.style.cssText = "color:#ddd;font-size:15px;";
    row.appendChild(lbl);

    const select = document.createElement("select");
    select.style.cssText = "background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:6px 10px;color:#ddd;font-size:13px;cursor:pointer;font-family:inherit;";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === initialValue) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => onChange(select.value));
    row.appendChild(select);
    return row;
  }
}
