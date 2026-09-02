# Wireframes

One SVG per screen, referenced from [`../design-v0.1.md`](../design-v0.1.md).

| File | Screen |
|---|---|
| `01-today.svg` | Today — the day's inspection list |
| `02-inspection.svg` | Inspection — the checklist |
| `03-capture.svg` | Capture — photo, markup, note |
| `04-review-complete.svg` | Review & complete |
| `05-outbox.svg` | Outbox — sync queue |
| `06-resolve.svg` | Resolve — conflict resolution |

## Conventions

- **360 x 620** viewBox, roughly a phone at 1x. Structural only — no styling intent.
- Colours are **fixed light-mode literals**, not theme-aware, and each file paints its own background. An SVG embedded in a markdown viewer has no reliable way to read the host theme, so a self-contained light card is the only version that stays readable everywhere.
- Fonts are **generic system stacks** (`monospace`, Arial) so the files render identically without any font being installed.
- Colour never carries meaning alone — every status also has a word, matching the app rule.

## Status palette

| Meaning | Hex | Tint |
|---|---|---|
| Ink / primary | `#171A16` | — |
| Muted | `#6B7268` | — |
| Rule | `#CFD3C8` | — |
| On this device / waiting | `#96590A` | `#F6EDDF` |
| Sending | `#14559E` | `#E2ECF6` |
| Sent / pass | `#1B6E3C` | `#E3EFE7` |
| Needs your call / fail | `#A81E1A` | `#F7E4E3` |

## Editing

Hand-authored XML — open in any text editor, or in Figma / Inkscape / Illustrator. Keep them as SVG rather than exporting PNG: they diff line-by-line in git, which is the point.
