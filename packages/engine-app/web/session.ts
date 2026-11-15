/**
 * The sign-in: same-origin requests with the cookie the browser keeps; the token is sent once, to sign in, and never
 * stored. A 401 anywhere means signed out, and the page asks for the token again.
 */

export class SignedOut extends Error {}

const signedOut = new EventTarget();
export const onSignedOut = (then: () => void) => signedOut.addEventListener("signed-out", then);

/** One request to the app's server; a 401 signs the page out. */
export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: "same-origin" });
  if (res.status === 401) {
    signedOut.dispatchEvent(new Event("signed-out"));
    throw new SignedOut();
  }
  return res;
}

/** Signs in with the engine's token; false when it is not the token. */
export async function signIn(token: string): Promise<boolean> {
  const res = await fetch("../session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

/** Ends this browser's sign-in at the server, and the page asks for the token again. */
export async function signOut(): Promise<void> {
  await fetch("../session", { method: "DELETE", credentials: "same-origin" });
  signedOut.dispatchEvent(new Event("signed-out"));
}
