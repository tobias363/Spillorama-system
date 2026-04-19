// PR-B7 (BIN-675) — stub; real implementation lands in commit 4.
// Keeping an export so the dispatcher in index.ts compiles alongside the
// ForgotPassword commit.
export function renderRegisterPage(root: HTMLElement, _onSuccess: () => void): void {
  root.innerHTML = `<div class="login-box"><div class="login-box-body"><p>RegisterPage placeholder (PR-B7 commit 4).</p></div></div>`;
}
