// PR-B7 (BIN-675) — stub; real implementation lands in commit 3.
// Keeping an export so the dispatcher in index.ts compiles alongside the
// ForgotPassword commit.
export function renderResetPasswordPage(root: HTMLElement, _token: string): void {
  root.innerHTML = `<div class="login-box"><div class="login-box-body"><p>ResetPasswordPage placeholder (PR-B7 commit 3).</p></div></div>`;
}
