import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";

function AdminPlaceholder() {
  return (
    <main id="main-content" className="wrap">
      <h1>Pariksha admin</h1>
      <p>The organiser application arrives with sign-in.</p>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <AdminPlaceholder />
  </StrictMode>,
);
