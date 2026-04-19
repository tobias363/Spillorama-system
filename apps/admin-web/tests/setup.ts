// Vitest jsdom setup — install a Map-backed localStorage/sessionStorage that
// survives the test lifecycle. Some jsdom versions expose a stub without
// .getItem, which breaks anything that reads storage at import time.
function installStorage(name: "localStorage" | "sessionStorage"): void {
  const store = new Map<string, string>();
  const impl: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, name, {
    value: impl,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, name, {
    value: impl,
    configurable: true,
    writable: true,
  });
}

installStorage("localStorage");
installStorage("sessionStorage");
