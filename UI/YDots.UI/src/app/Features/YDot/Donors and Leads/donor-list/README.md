# Donor List - "Donor ledger"

## Layout

1. **Page header** (shared `app-page-header`): Refresh, Export (Excel / CSV / Print). Export uses the selected donors when any are ticked, otherwise every donor in view.
2. **Summary**: one white sheet, two bands.
   - Four equal figures: Lifetime received, Donors on record, Gave in the last 90 days, Yet to give.
   - A slim "Needs attention" row with five count + label cells: follow-ups overdue, follow-ups due today, identity not verified, consent to review, without an owner. Each cell filters the list.
3. **Donors register**: one white sheet.
   - Title, live range and sort line, Table / Cards switch.
   - Status tabs (All, Active, Prospect, Restricted, Archived, Merged) with counts.
   - Search, sort field and direction, Filters panel (owner, campaign, last-gift period, follow-up, identity, consent).
   - Removable tokens for every applied filter.
   - Table rows or donor cards, then a pager (12 / 24 / 48 per page, so the card grid fills its rows).
   - A floating selection bar when donors are ticked.
4. **Donor sheet** (quick look, eye action): giving figures, standing (follow-up, identity, consent, each with a note and a direct action), relationship and contact. The frame comes from the Donors "Aurora" design in `styles/ydot-dialogs.css`, which is generated; position and contents live here.

Clicking a row or card opens Donor 360. All navigation destinations and query parameters are unchanged.

## Data

Rows come from `WorkflowStateService.donors()`, which maps `DON /api/v1/donors` (`DonorListItem`). The service used to blank contact, campaign, gifts, lifetime giving, follow-up, identity and consent, so every donor showed ₹0 and dashes. It now carries them through, plus `status`, `currency` and `contactMasked`. Masked contact shows a lock and is never unmasked in the browser.

## Styling rules

- No shadows and no colour-filled blocks. Colour lives on rules, rings, outlines, underlines, glyphs and type.
- Every length is `calc(Npx * var(--s))` so it follows `--ui-scale`.
- Type declarations carry `!important` because `styles.css` forces sizes globally.
- Class names avoid the `-card / -badge / -pill / -chip / -tag / icon` traps in `ydot-premium.css`.
- Container queries on `.dn-page` handle responsiveness:
  - 1320px: contact folds under the name, and "Needs attention" sits under its caption;
  - 1000px: rows stack and the summary goes 2 × 2;
  - 600px: single column.
