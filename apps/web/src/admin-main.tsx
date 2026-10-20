import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/admin.css";
import "./styles/testbuilder.css";
import { OrganiserApp } from "./routes/organiser";
import { createApiClient } from "./lib/api";
import { readGround } from "./lib/ground";

// Before anything renders, and before the #root check below, so even the
// failure path is on the viewer's ground: D20's switch is one attribute on
// <html> that theme.css keys both palettes off. Reading it here rather than
// on mount is what stops the page flashing the wrong ground.
//
// The attribute, not writeGround: a seeded ground is not a choice, and
// storing it on first visit would freeze the viewer's OS preference.
document.documentElement.dataset.theme = readGround();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

// The raw query value, not a sanitised one: validation belongs in one place
// (lib/api's safeReturnTo), at the point the value becomes a URL.
//
// Falling back to this page rather than to safeReturnTo's "/": a sign-in
// started here has to end here. "/" is the landing page, so an organiser who
// opened the app directly would come back from the identity provider onto
// the marketing site, signed in and with nothing to show for it — which is
// what the end-to-end first-run flow caught.
const returnTo =
  new URLSearchParams(window.location.search).get("returnTo") ??
  window.location.pathname;

createRoot(container).render(
  <StrictMode>
    <OrganiserApp client={createApiClient()} returnTo={returnTo} />
  </StrictMode>,
);
