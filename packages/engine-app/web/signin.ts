import { h, one } from "./dom.js";
import { command, field } from "./field.js";
import { signIn } from "./session.js";

/**
 * Signing in: the engine's own token, typed once. The server checks it and answers with a cookie this page's script
 * can never read; the token itself is not kept anywhere here.
 */

const view = one("#view-signin");

export function askToSignIn(signedIn: () => void): void {
  const token = h("input", {
    className: "token-input",
    type: "password",
    name: "token",
    autocomplete: "current-password",
    required: true,
    attrs: { "aria-label": "The engine's token", placeholder: "Paste the token" },
  });
  const wrong = h("p", { className: "field-line field-wrong", attrs: { role: "alert" } });
  const form = h(
    "form",
    { className: "token-form" },
    token,
    h("button", { className: "amber-button", type: "submit" }, "Sign in"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    wrong.textContent = "";
    if (await signIn(token.value)) return signedIn();
    wrong.textContent = "That is not this engine's token.";
    token.select();
  });
  view.replaceChildren(
    field({
      eyebrow: "Louvain Engine",
      title: "Sign in to your engine.",
      lines: [
        "Its token is in the engine's folder, written there when it first started.",
        command("cat .engine/token"),
      ],
      action: h("div", { className: "field-action" }, form, wrong),
    }),
  );
  token.focus();
}
