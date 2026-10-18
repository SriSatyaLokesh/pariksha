import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/admin.css";
import { OrganiserApp } from "./routes/organiser";
import { createApiClient } from "./lib/api";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

// The raw query value, not a sanitised one: validation belongs in one place
// (lib/api's safeReturnTo), at the point the value becomes a URL.
const returnTo = new URLSearchParams(window.location.search).get("returnTo");

createRoot(container).render(
  <StrictMode>
    <OrganiserApp client={createApiClient()} returnTo={returnTo} />
  </StrictMode>,
);
