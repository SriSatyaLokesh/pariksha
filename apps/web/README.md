# apps/web

Candidate and admin interfaces for Pariksha. React + Vite + TypeScript, with separate bundles so candidates download as little as possible.

**Status:** the landing page, design tokens, and the two Vite entry points (candidate `index.html`, admin `admin.html`) are built and deployed to Cloudflare Workers static assets — see [deploy/cloudflare/README.md](../../deploy/cloudflare/README.md). Sign-in, the test-creation wizard, and the candidate/admin dashboards are not built yet (Task 9). Requirements: [PRD — Candidate experience](../../docs/PRD.md#candidate-experience) and [Creating and configuring tests](../../docs/PRD.md#creating-and-configuring-tests).
