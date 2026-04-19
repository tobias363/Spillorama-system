import noDict from "./no.json";
import enDict from "./en.json";

type Dict = Record<string, string>;

export type Lang = "no" | "en";

const dicts: Record<Lang, Dict> = {
  no: noDict as Dict,
  en: enDict as Dict,
};

const LANG_STORAGE_KEY = "spillorama.admin.lang";

let currentLang: Lang = "no";

export function initI18n(): void {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === "no" || stored === "en") {
    currentLang = stored;
  } else {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("lang");
    if (fromUrl === "en") currentLang = "en";
    else currentLang = "no";
  }
  document.documentElement.setAttribute("lang", currentLang === "no" ? "nb" : "en");
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  document.documentElement.setAttribute("lang", lang === "no" ? "nb" : "en");
  window.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang } }));
}

export function getLang(): Lang {
  return currentLang;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dicts[currentLang];
  let value = dict[key];
  if (value === undefined) {
    const fallback = dicts.en[key];
    value = fallback ?? key;
  }
  if (params) {
    for (const [pk, pv] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{\\{\\s*${pk}\\s*\\}\\}`, "g"), String(pv));
    }
  }
  return value;
}
