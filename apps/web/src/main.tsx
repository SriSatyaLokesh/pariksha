import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./routes/landing";
import "./styles/base.css";
import "./styles/landing.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
