# Self-hosted fonts

All four files are variable fonts trimmed to `font-weight: 400 500` (the only two weights
`DESIGN.md` uses) and subset per the ranges below. Downloaded once from Google Fonts and
committed here so the page never makes a third-party font request (`S-11`).

| File                                 | Source                                                                                                                                | Version             | Subset                                                                                                                                                                                                                     | Licence                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `anek-latin-latin-400-500.woff2`     | https://fonts.gstatic.com/s/aneklatin/v11/co3WmWZulTRoU4a8dqrWiajBS5ByUkvdrluH-z-KzhM.woff2                                           | Anek Latin v11      | Latin + Latin Extended, punctuation, currency (U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD) | `OFL-anek.txt` (SIL OFL 1.1)                                            |
| `jetbrains-mono-latin-400-500.woff2` | https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2                | JetBrains Mono v24  | Same range as Anek Latin above                                                                                                                                                                                             | `OFL-jetbrains-mono.txt` (SIL OFL 1.1)                                  |
| `anek-telugu-wordmark-500.woff2`     | https://fonts.gstatic.com/l/font?kit=LhWLMVrUNvsddMtYGCx4FcVWOjlwE1WgXdoJ-5XHMl2DkooGK7i13x2-oEie3N0&skey=574bd2feb0646fc0&v=v13      | Anek Telugu v13     | Text-subset to the wordmark glyphs only (`పరీక్ష`); unicode-range U+0C00-0C7F, U+200C-200D                                                                                                                                 | `OFL-anek.txt` (identical text to Anek Latin's licence; see note below) |
| `anek-devanagari-wordmark-500.woff2` | https://fonts.gstatic.com/l/font?kit=jVyo7nP0CGrUsxB-QiRgw0NlLaVt_QUAkYxLRoCL23mlh20ZVHOMAWbgHLDfku9iDkg8&skey=9455048a98a27cad&v=v17 | Anek Devanagari v17 | Text-subset to the wordmark glyphs only (`परीक्षा`); unicode-range U+0900-097F, U+200C-200D                                                                                                                                | `OFL-anek.txt` (identical text to Anek Latin's licence; see note below) |

`OFL-anek.txt` and `OFL-jetbrains-mono.txt` are each family's full SIL Open Font License
1.1 text. The Anek Telugu and Anek Devanagari OFL texts were compared against Anek
Latin's and are byte-identical (same copyright line, same licence body), so no separate
`OFL-anek-telugu.txt` / `OFL-anek-devanagari.txt` files are committed — `OFL-anek.txt`
covers all three Anek scripts.

**Why the Telugu and Devanagari files are so small:** the landing page renders exactly
two words in those scripts (the wordmark subtitle, `పరీక్ష · परीक्षा`). Shipping the full
script slices (140 KB and 258 KB respectively) to draw eleven glyphs would be a poor
trade against the 300 KB page-weight budget. The full script slices arrive with
translated tests in Phase 12 (P12.2), where the glyph coverage is actually needed —
see `.superpowers/sdd/2026-10-16-phase-3-auth-roles-and-landing/fonts-manifest.md`.

**To regenerate:** re-download from the URLs above with a desktop User-Agent (Google
serves WOFF2 only to modern UAs) — `curl -sL -A "Mozilla/5.0 ..." -o <file> <url>`.
