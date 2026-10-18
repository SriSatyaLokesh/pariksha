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

/** `password` is Phase 11 and Docker-only (ADR 0002); nothing lists it yet. */
export function identityProviders(env: AppEnv): IdentityProvider[] {
  const oidc: IdentityProvider[] = (env.oidcProviders ?? []).map(
    ({ id, label }) => ({ id, kind: "oidc", label }),
  );
  return env.email || env.allowConsoleEmail
    ? [...oidc, { id: "magic-link", kind: "magic_link", label: "Email a link" }]
    : oidc;
}
