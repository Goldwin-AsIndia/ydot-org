# Handoff: Communication Timeline + Log Communication redesign

**Date:** 2026-10-02
**Status:** Code is written and the Angular build passes. The visual check in a browser has **not** been done yet.

---

## 1. The user's request (verbatim)

> communication timeline and log communication screens looks very big, i need u to completely redesign and restructure everything professionally to give a premium look. and reduce the height of all the sections

---

## 2. Where the code lives

Component folder (both screens live in ONE component):
`UI/YDots.UI/src/app/Features/YDot/Donors and Leads/communication-timeline/`

| File | What changed |
|---|---|
| `communication-timeline.html` | Timeline + Log markup fully rewritten. The bottom part (glyph `ng-template`, detail drawer `ct-drawer`, temperature / potential / export modals `ct-modal`) is **unchanged**. |
| `communication-timeline.css` | Fully regenerated (~550 lines). The `ct-*` dialog block in the middle is the old CSS, unchanged. |
| `communication-timeline.ts` | Only one change: the CSS variable `--lb-top` was renamed to `--le-top` in the sticky-bar effect. All logic and signals are unchanged. |

Route: `/app/fundraising/relationships/communication-timeline?leadId=...` (or `?donorId=...`). You need to sign in to see it.

The old version is still in git. To see it, run `git diff` on the folder, or `git show HEAD:"UI/YDots.UI/src/app/Features/YDot/Donors and Leads/communication-timeline/communication-timeline.css"`.

---

## 3. New design

### Communication Timeline: "Contact ledger" (prefix `tl-`, container `tl`)
Everything sits on ONE white sheet. There is no separate masthead card and no separate side cards.
1. **Head row** (about 60px): display-face name, gold `DONOR`/`LEAD` kicker, mono ref, outlined stage tag, and one contact line (phone · email · language · owner) on the left. On the right: outlined **Donor 360 / My leads**, outlined **Export**, and primary **Log communication**. All buttons are 34u tall.
2. **Figure strip**: seven equal cells split by hairlines (a grid `gap:1px` on a line-coloured background): Logged, Calls, Emails, Meetings, Last contact, Health (score + status word + 2px meter), and Last 8 weeks (56-day cadence ticks coloured by channel). At ≤1320px the cadence cell spans a full row. Below that the strip goes to 3 columns, then 2.
3. **Body** = ledger | standing rail (300u):
   - **Ledger bar**: underlined channel tabs with counts on the left. On the right, a short 220u search box and an outlined **Filters** button with a count. The filter row drops below the bar when it is open.
   - **Day groups**: a 96u date column (mono day, gold month, relative day or weekday) beside the entries. Each entry is a bare channel glyph, then the title, a ★ if important, direction, outcome (dot + word), "by", and the time on the right. Below that come a 2-line summary clamp, a 1-line italic note with a gold left rule, and any attachment. The row has three real 28u outlined buttons: view, edit, star.
   - **Footer**: "Showing a–b of n · newest first" and an outlined pager.
   - **Standing rail**: Next best step (with an outlined Schedule a follow-up button), Standing (Temperature and Potential as underlined word scales, plus a pencil button that opens the existing modals), Record ledger, and Activity ledger. The ledgers use dotted leaders.
   - At ≤1080px the rail drops under the ledger in 2 columns, then 1.

### Log communication (prefix `le-`, container `le`)
It still renders **in place of the timeline inside the app shell**, so the side menu and top bar stay visible. The timeline `.tl` is hidden with `display:none` and the log sheet is shown with `@if (isEntryDrawerOpen())`. Everything is on ONE white sheet:
- **Sticky bar**: outlined "Timeline" back button, display title + "Name · REF" line, three save checks (Date / Time / Summary, dashed ring → green tick), Cancel, and Save. A 2px theme-to-gold progress rule runs along the bottom edge. The sticky offset `--le-top` comes from the TS effect.
- **The form is a set of ruled bands:**
  1. Channel: 8 outlined buttons (glyph + word). The selected one gets an outline in the channel colour.
  2. Day / Time / Direction on one row, split by hairlines. Day = 7 small day leaves plus a dashed "Earlier" date picker. Time = an input with a "Use now" link. Direction = a segmented Outgoing ↗ / Incoming ↙ control.
  3. Outcome: 4 kinds (Reached / Warm signals / Awaiting / Closed) side by side. Each option is an outlined button with a coloured dot.
  4. Engagement | Quality as segmented scales with signal bars.
  5. Summary | Internal note as two textareas side by side. The sentence-opener buttons and the counter sit in the label row. The note has a gold left rule.
  6. Foot: dashed attach slip, a "Mark as important" slip, and the Ctrl+Enter / Esc key hints.
- **Context rail** (320u): who (name, contacts, Health / Last contact / Temperature / Potential ledger), "How it will read" preview, and Recent entries (last 3) with the suggested next step. At ≤1240px it drops below the form in 3 columns.

### Rules this design follows (from the user's earlier feedback; memory files are in `C:\Users\prade\.claude\projects\C--Pradeesh-Ydot-prad\memory\`)
- No dark or colour-filled blocks and no shadows. Selected states are outlines or underlines. The only fill is the primary button.
- **No initials or circle avatars anywhere.** The old `lb-seal` and the initials in the direction map were removed.
- Compact sizes. "Premium" must not mean large. Titles go inside the sheet, with no page-header description.
- Every length is `calc(Npx * var(--u))` and every font-size is `calc(calc(Npx * var(--u)) * var(--ui-text-scale, 1)) !important`. Font-weight and line-height also carry `!important`, because global `styles.css` forces them.
- SVG sizes are set with `!important` width and height.
- Class names avoid the global traps: nothing ends in `-card`, `-badge`, `-pill`, `-chip` or `-tag`, and nothing contains `icon`. No `data-tone`.
- The detail drawer and modals keep the shared dialog layer: `.ct-drawer` and `.ct-modal` are registered in `tools/generate-dialog-styles.py`. Don't rename them.

---

## 4. How the CSS was produced (for further edits)

The CSS is generated from shorthand sources, which are copied into `handoff/communication-timeline/src/`:
- `page.src.css`: timeline styles (`u(N)`, `fs(N)`, `fw(N)`, `ic(N)` macros)
- `dialogs.css`: the unchanged `ct-*` dialog block
- `log.src.css`: Log communication styles + print rules
- `top.html` + `tail.html`: the new top markup + the unchanged glyph/drawer/modal tail
- `build.py`: expands the macros, adds `!important` to font-size/weight/line-height, and writes the component `.css` and `.html`

To rebuild, run these from `UI/YDots.UI`:
```bash
python "../../handoff/communication-timeline/src/build.py"
```
```bash
python tools/font_role_vars.py "src/app/Features/YDot/Donors and Leads/communication-timeline"
```
Always pass the folder argument to `font_role_vars.py`; without it the script rewrites every CSS file in `src/`. You can also just edit the generated `.css` directly. It is plain CSS.

> Note: `build.py` overwrites the component `.html` too (top.html + tail.html). If you edit the HTML directly, update `top.html` first or stop using the script.

---

## 5. What is left to do

1. **Visual check** (not done). The app needs a sign-in. Options:
   - Sign in on the running dev server and open the route above with a real `leadId`. Check the timeline, then click **Log communication**.
   - Or use the sign-in-free JIT harness from memory (`ydot-ui-global-style-traps.md`, last bullets). This build already succeeded into `C:\Users\prade\AppData\Local\Temp\claude\C--Pradeesh-Ydot-prad\4ed7ac0a-9802-41f4-82df-9b18122d891f\scratchpad\build`. A reusable harness example is at `...\e98c114f-ce85-4a4a-b143-c0912fc28d9d\scratchpad\harness-src\` (harness.html importmap + harness.js + serve.py). For this component, stub `DonorApiService.getCommunicationTimeline` (returns `of(response)` with `displayName`, `leadReference`, `mobileNumber`, `emailAddress`, `ownerName`, `status`, `healthScore`, `temperature`, `donationPotential`, `entries[]` with `id`, `occurredAtUtc`, `interactionType`, `channel`, `direction`, `outcome`, `summary`, `notes`, `performedByName`), `ToastService.show`, `Router.navigate`, `ActivatedRoute.snapshot.queryParamMap`, and `PageHeader`.
   - Check at 1920×1080 with `--ui-scale` 1.25. Heights should be small: the timeline head + strip should be about 140px, and the log form should fit about one screen.
2. Fix any visual issues you find. The likely spots:
   - Outcome kinds wrapping at medium widths
   - Day-leaf row width in the When band
   - The channel button grid
   - The sticky bar offset (`--le-top`)
3. Update the memory file `ydot-design-distinct-per-module.md`. Replace the "Communication Timeline = Correspondence journal" / "Log communication = Conversation brief" notes with this new compact "Contact ledger" + one-sheet log design, and record any feedback the user gives.
4. Do not commit `handoff/` unless the user wants it in git. Commit only when the user asks.
