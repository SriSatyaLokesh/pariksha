# Export endpoints

Every endpoint below lives under `/api/v1/workspaces/:id/tests/:testId/export/`
and returns `{ csv, nextCursor, filename }` (`test.json` excepted — it returns
the test document itself). `nextCursor` is `null` once a page comes back
short of its limit; a full page always carries a cursor, so pulling pages
until `nextCursor` is `null` never silently drops a row.

| File | Permission | What it carries |
| --- | --- | --- |
| `results.csv` | `results.export` | one row per candidate |
| `answers.csv` | `results.export` | one row per answer |
| `test.json` | `results.export` | the whole test document, including keys and explanations |
| `events.csv` | `attempts.read_evidence` | one row per proctoring event |
| `snapshots.csv` | `attempts.read_evidence` | one row per webcam snapshot, as a manifest (below) |

A Viewer holds `results.export` but not `attempts.read_evidence`: they can
pull results and the test definition, never the proctoring evidence behind
them.

## The snapshot manifest, not a ZIP

`snapshots.csv` is a manifest, not an archive: one row per snapshot, each
carrying a presigned URL rather than the image bytes. Downloading every
object server-side and zipping it would cost one storage read per image —
easily over a thousand reads for a mid-size cohort — against a platform limit
of 50 reads per request. A manifest of any size costs the same handful of
reads the paging itself needs, because minting a presigned URL costs nothing
extra.

Columns: `Attempt`, `Candidate`, `Taken at`, `Reason`, `Face count`, `Status`,
`URL`.

- **`Face count`** reads `not counted` rather than `0` when the product has
  never counted faces on that snapshot (true for every snapshot today —
  on-device face counting has not shipped). `not counted` and "zero faces
  seen" are different facts; the column never conflates them.
- **`Status`** reads `deleted` when the object a row points at has already
  been removed by the retention schedule. A `deleted` row's `URL` cell is
  empty — never a link that would 404 if you followed it.
- The file's first line, above the column header, is a comment stating the
  URL expiry: `# Pariksha snapshot manifest - each URL expires 600 seconds
  after this file was generated; see docs/exports.md for a curl/wget
  one-liner to pull them down before then.` Skip it (or any line starting
  with `#`) before parsing the file as CSV.

### Downloading every snapshot in a manifest

URLs expire 600 seconds (10 minutes) after the file was generated — the same
`SIGNED_URL_TTL_SECONDS` every presigned URL in the product uses, not
lengthened for this export. Re-fetch the manifest if you did not finish in
time.

```bash
# Skip the comment line and the header, then fetch whichever URL column is
# last; cut -f1 -d, before piping through if you need the attempt id too.
tail -n +3 snapshots.csv \
  | awk -F',' '{print $NF}' \
  | grep -v '^$' \
  | while read -r url; do curl -sO "$url"; done
```

```bash
# wget, equivalent
tail -n +3 snapshots.csv | awk -F',' '{print $NF}' | grep -v '^$' | wget -i -
```

A row with an empty `URL` cell (`Status` is `deleted`) is skipped by both —
`grep -v '^$'` drops it before the download loop ever sees it.
