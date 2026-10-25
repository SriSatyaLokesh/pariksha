// What a sign-in screen is allowed to offer, derived from configuration
// rather than hard-coded: an instance with no OIDC provider must not show a
// button that cannot work, and one with no way to send email must not offer
// a magic link.

import type { AppEnv } from "../env.js";

export interface IdentityProvider {
  id: string;
  kind: "oidc" | "magic_link" | "password";
  label: string;
}

/** Phase 10: `password` is Docker/Node-only (S-01, ADR 0002). */
export function identityProviders(env: AppEnv): IdentityProvider[] {
  const providers: IdentityProvider[] = (env.oidcProviders ?? []).map(
    ({ id, label }) => ({ id, kind: "oidc", label }),
  );
  if (env.email || env.allowConsoleEmail) {
    providers.push({ id: "magic-link", kind: "magic_link", label: "Email a link" });
  }
  if (env.target === "node") {
    providers.push({ id: "password", kind: "password", label: "Email and password" });
  }
  return providers;
}
