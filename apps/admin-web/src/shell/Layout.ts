import { renderHeader } from "./Header.js";
import { renderSidebar } from "./Sidebar.js";
import { renderFooter } from "./Footer.js";
import { renderBreadcrumb } from "./Breadcrumb.js";
import type { Session } from "../auth/Session.js";
import type { RouteDef } from "../router/routes.js";

export interface LayoutRefs {
  root: HTMLElement;
  headerHost: HTMLElement;
  sidebarHost: HTMLElement;
  breadcrumbHost: HTMLElement;
  contentHost: HTMLElement;
  footerHost: HTMLElement;
}

export function mountLayout(rootSelector: string): LayoutRefs {
  const root = document.querySelector<HTMLElement>(rootSelector);
  if (!root) throw new Error(`Root ${rootSelector} not found`);
  root.removeAttribute("data-state");
  document.body.classList.remove("login-page");
  document.body.classList.add("hold-transition", "skin-blue", "sidebar-mini");

  root.innerHTML = `
    <div class="wrapper">
      <div id="shellHeader"></div>
      <div id="shellSidebar"></div>
      <div class="content-wrapper">
        <div id="shellBreadcrumb"></div>
        <section class="content">
          <div id="shellContent"></div>
        </section>
        <div class="control-sidebar-bg"></div>
      </div>
      <div id="shellFooter"></div>
    </div>`;

  return {
    root,
    headerHost: root.querySelector<HTMLElement>("#shellHeader")!,
    sidebarHost: root.querySelector<HTMLElement>("#shellSidebar")!,
    breadcrumbHost: root.querySelector<HTMLElement>("#shellBreadcrumb")!,
    contentHost: root.querySelector<HTMLElement>("#shellContent")!,
    footerHost: root.querySelector<HTMLElement>("#shellFooter")!,
  };
}

export function renderLayoutChrome(
  refs: LayoutRefs,
  session: Session,
  route: RouteDef | undefined,
  currentPath: string,
  maintenanceMode: boolean
): void {
  renderHeader(refs.headerHost, session, maintenanceMode);
  renderSidebar(refs.sidebarHost, session, currentPath);
  renderBreadcrumb(refs.breadcrumbHost, route, currentPath);
  renderFooter(refs.footerHost);
}
