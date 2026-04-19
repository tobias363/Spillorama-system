import { findRoute, type RouteDef } from "./routes.js";

export type PageRenderer = (container: HTMLElement, route: RouteDef) => void | Promise<void>;

export interface RouterConfig {
  container: HTMLElement;
  renderer: PageRenderer;
  onUnknown?: (path: string, container: HTMLElement) => void;
  onChange?: (route: RouteDef | undefined, path: string) => void;
}

export class Router {
  private cfg: RouterConfig;
  private boundHandler: () => void;

  constructor(cfg: RouterConfig) {
    this.cfg = cfg;
    this.boundHandler = () => void this.handle();
  }

  start(): void {
    window.addEventListener("hashchange", this.boundHandler);
    window.addEventListener("popstate", this.boundHandler);
    void this.handle();
  }

  stop(): void {
    window.removeEventListener("hashchange", this.boundHandler);
    window.removeEventListener("popstate", this.boundHandler);
  }

  navigate(path: string): void {
    window.location.hash = `#${path}`;
  }

  currentPath(): string {
    const hash = window.location.hash.replace(/^#/, "");
    return hash || "/admin";
  }

  private async handle(): Promise<void> {
    const path = this.currentPath();
    const route = findRoute(path);
    this.cfg.onChange?.(route, path);
    if (!route) {
      this.cfg.onUnknown?.(path, this.cfg.container);
      return;
    }
    await this.cfg.renderer(this.cfg.container, route);
  }
}
