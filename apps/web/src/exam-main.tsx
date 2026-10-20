import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/exam.css";
import { ExamApp } from "./routes/exam";
import { createRunClient, slugPairFromPath } from "./lib/run";

// Binding code only, the way `admin-main.tsx` is: the URL is read once here
// (T-02 fixes it at `/<workspace-slug>/<test-slug>`) and everything worth a
// test lives in `routes/exam.tsx` and `lib/run.ts`.

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

const slugs = slugPairFromPath(window.location.pathname);
if (!slugs) {
  // Not a candidate URL at all. Rather than mount an app that will ask the
  // API about two slugs it does not have, hand the visitor back to the
  // site, which is what the host's own 404 would have done had this page
  // not been the fallback.
  window.location.replace("/");
} else {
  createRoot(container).render(
    <StrictMode>
      <ExamApp client={createRunClient(slugs.workspaceSlug, slugs.testSlug)} />
    </StrictMode>,
  );
}
