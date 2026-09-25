# Donor List - "Patron register"

## Layout

1. **Page header** (shared `app-page-header`): Refresh, Export (Excel / CSV / Print). Export uses the selected donors when any are selected, otherwise every donor in view.
2. **Giving statement**, one white sheet:
   - lifetime giving summed over the donors in view (all filters, every page), with donor count and average;
   - Total / New / Active / Follow-ups due figures between hairlines;
   - the engagement mix as a thin proportion rule. Its legend filters the register by engagement.
3. **Donor register**, one white sheet:
   - title, live range and sort line, search;
   - view tabs with counts: All donors / Follow-up due / Not verified / Consent review;
   - period, sort field, sort direction, Filters (owner, campaign, region, verification, consent);
   - a selection line when donors are ticked (export or clear the selection);
   - column captions (click to sort) and donor rows: monogram ringed in the engagement colour, contact, campaign and owner, last gift, lifetime giving with a share-of-page bar, follow-up and ID standing, then actions;
   - numbered pager (10 per page).

Clicking a row opens Donor 360. The eye action opens the quick-look drawer. Its frame comes from the Donors "Aurora" design in `styles/ydot-dialogs.css`, which is generated. Ticking a checkbox only selects the donor.

## Data

Donors come from `WorkflowStateService.donors()` (`DON /api/v1/donors`). Refresh calls `workflow.refresh()`. Loading and error states follow the service's `isLoading` and `loadError`. The old `/assets/data/donors.json` fetch was removed. That file no longer exists, so the screen always showed "Unable to load donors".

## Styling rules

- No shadows and no dark or colour-filled blocks. Colour appears only in rules, rings, underlines, glyphs and type.
- Every length is `calc(Npx * var(--s))` so it follows `--ui-scale`.
- Type declarations carry `!important` because `styles.css` forces sizes globally.
- Class names avoid the `-card / -badge / -pill / -chip / -tag / icon` traps in `ydot-premium.css`.
- Responsive layout uses container queries on `.dn-page`:
  - below 1240px the contact column folds into the donor cell;
  - below 1020px the statement stacks;
  - below 960px rows become stacked blocks.
