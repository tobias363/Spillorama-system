import { Theme1GameShell } from "@/features/theme1/components/Theme1GameShell";
import { Theme1AnimationLab } from "@/features/theme1-lab/components/Theme1AnimationLab";

export function App() {
  return resolveAppView(readCurrentPathname()) === "animation-lab" ? (
    <Theme1AnimationLab />
  ) : (
    <Theme1GameShell />
  );
}

const ANIMATION_LAB_PATHS = new Set(["/animation-lab", "/animasjon-lab"]);

export function resolveAppView(pathname: string): "game" | "animation-lab" {
  const normalizedPath = normalizePathname(pathname);
  return ANIMATION_LAB_PATHS.has(normalizedPath) ? "animation-lab" : "game";
}

function readCurrentPathname() {
  if (typeof window === "undefined") {
    return "/";
  }

  return window.location.pathname;
}

function normalizePathname(pathname: string) {
  const normalizedPath = pathname.trim().replace(/\/+$/, "");
  return normalizedPath.length > 0 ? normalizedPath : "/";
}
