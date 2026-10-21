/**
 * Hand the browser a JSON document to save.
 *
 * Phase 6.5e Task 4: one copy. `routes/bank.tsx` and `routes/tests.tsx`
 * each carried an identical private `downloadJson` (bank export, question
 * export, test export), and `D18`'s "Download a sample" would have been a
 * third — at which point the object-URL lifetime, the `download`
 * attribute and the revoke are four things to keep in step instead of one.
 *
 * `revokeObjectURL` in a `finally`, because the click is synchronous: the
 * browser has already started the save by the time this returns, and an
 * un-revoked blob URL holds its Blob for the life of the document.
 */
export function downloadJson(doc: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
