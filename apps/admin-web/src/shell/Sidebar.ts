import { t } from "../i18n/I18n.js";
import type { Session } from "../auth/Session.js";
import { hasPermission } from "../auth/permissions.js";
import { type SidebarLeaf, type SidebarGroup, sidebarFor } from "./sidebarSpec.js";

function isVisible(node: SidebarLeaf | SidebarGroup, session: Session): boolean {
  if (node.roles && node.roles.length > 0 && !node.roles.includes(session.role)) return false;
  if (node.kind === "leaf") {
    if (node.superAdminOnly && !session.isSuperAdmin) return false;
    if (node.agentOnly && session.role !== "agent") return false;
  }
  if (node.module) {
    if (session.role === "admin" || session.role === "super-admin") return true;
    return hasPermission(node.module, "view");
  }
  return true;
}

function el(tag: string, attrs: Record<string, string> = {}, children: Array<Node | string> = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function renderLeaf(leaf: SidebarLeaf, currentPath: string): HTMLLIElement {
  const li = el("li") as HTMLLIElement;
  if (leaf.path === currentPath) li.classList.add("active");
  const a = el("a", { href: `#${leaf.path}`, "data-route-id": leaf.id });
  a.append(el("i", { class: leaf.icon }));
  a.append(document.createTextNode(" "));
  a.append(el("span", {}, [t(leaf.labelKey)]));
  li.append(a);
  return li;
}

function renderGroup(group: SidebarGroup, currentPath: string): HTMLLIElement {
  const li = el("li", { class: "treeview", "data-group-id": group.id }) as HTMLLIElement;
  const anchor = el("a", { href: "#" });
  anchor.append(el("i", { class: group.icon }));
  anchor.append(document.createTextNode(" "));
  anchor.append(el("span", {}, [t(group.labelKey)]));
  const pull = el("span", { class: "pull-right-container" });
  pull.append(el("i", { class: "fa fa-angle-left pull-right" }));
  anchor.append(pull);
  li.append(anchor);

  const ul = el("ul", { class: "treeview-menu" }) as HTMLUListElement;
  let hasActive = false;
  for (const child of group.children) {
    const childLi = renderLeaf(child, currentPath);
    if (child.path === currentPath) {
      hasActive = true;
      li.classList.add("active", "menu-open");
    }
    ul.append(childLi);
  }
  if (hasActive) ul.setAttribute("style", "display: block;");
  li.append(ul);
  return li;
}

export function renderSidebar(container: HTMLElement, session: Session, currentPath: string): void {
  container.innerHTML = "";
  const aside = el("aside", { class: "main-sidebar" });
  const section = el("section", { class: "sidebar" });

  // User panel
  const userPanel = el("div", { class: "user-panel" });
  const imgWrap = el("div", { class: "pull-left image" });
  const avatar = session.avatar ? `/profile/${session.avatar}` : "/admin/legacy-skin/img/user.png";
  imgWrap.append(el("img", { src: avatar, class: "img-circle", alt: "User Image", width: "50px", height: "50px" }));
  const info = el("div", { class: "pull-left info" });
  info.append(el("p", {}, [session.name]));
  const statusLink = el("a", { href: "#" });
  statusLink.append(el("i", { class: "fa fa-circle text-success" }));
  statusLink.append(document.createTextNode(" " + t("online")));
  info.append(statusLink);
  userPanel.append(imgWrap, info);
  section.append(userPanel);

  const ul = el("ul", { class: "sidebar-menu", "data-widget": "tree" }) as HTMLUListElement;

  const nodes = sidebarFor(session.role);
  for (const node of nodes) {
    if (node.kind === "header") {
      ul.append(el("li", { class: "header" }, [t(node.labelKey)]));
      continue;
    }
    if (!isVisible(node, session)) continue;
    if (node.kind === "leaf") {
      ul.append(renderLeaf(node, currentPath));
    } else {
      const visibleChildren = node.children.filter((c) => isVisible(c, session));
      if (visibleChildren.length === 0) continue;
      const filtered: SidebarGroup = { ...node, children: visibleChildren };
      ul.append(renderGroup(filtered, currentPath));
    }
  }
  section.append(ul);
  aside.append(section);
  container.append(aside);

  wireTreeviewToggle(aside);
}

function wireTreeviewToggle(root: HTMLElement): void {
  root.querySelectorAll<HTMLLIElement>("li.treeview").forEach((li) => {
    const anchor = li.querySelector<HTMLAnchorElement>(":scope > a");
    const menu = li.querySelector<HTMLUListElement>(":scope > ul.treeview-menu");
    if (!anchor || !menu) return;
    anchor.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = li.classList.contains("menu-open");
      if (isOpen) {
        li.classList.remove("menu-open");
        menu.style.display = "none";
      } else {
        li.classList.add("menu-open");
        menu.style.display = "block";
      }
    });
  });
}
