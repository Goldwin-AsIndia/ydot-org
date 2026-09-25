# Run: python tools/generate-dialog-styles.py   (from UI/YDots.UI)
# Generates src/styles/ydot-dialogs.css - the pop-up (dialog) and off-canvas (drawer) designs for every module
# except Campaigns. Each module gets its OWN design; the registries below name each screen's scrim, dialog and
# drawer classes and which module every screen belongs to.
# House rules (2026-09-25): no dark or colour-filled blocks anywhere (headers, sheets and footers are white; colour
# lives in rules, glyphs, type and the primary button), no dead space, plain readable type.
import textwrap, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "styles" / "ydot-dialogs.css"

# ------------------------------------------------------------------------------------------------ modules
# Host elements per module. Campaigns are deliberately absent: their dialogs keep their own designs. The
# document viewer (a dark lightbox for previewing files) keeps its own look too.
MODULES = {
    "admin": ["app-access-preview", "app-access-request", "app-bulk-user-administration", "app-create-user",
              "app-login-identifier-change", "app-menu-configuration", "app-menu-mapping", "app-mfa-enrollment",
              "app-my-security", "app-role-catalogue", "app-user-details", "app-user-directory",
              "app-user-profile", "app-user-security"],
    "comms": ["app-communication-exception-queue", "app-complaint-case", "app-conversation-detail",
              "app-outbound-message-composer", "app-sla-policy-calendar",
              "app-suppression-and-contact-restriction", "app-template-catalogue", "app-unified-inbox"],
    "config": ["app-payment-gateway-configuration"],
    "payments": ["app-payment-event-queue", "app-payment-result", "app-public-donation-initiation"],
    "donors": ["app-assignment-board", "app-communication-timeline", "app-consent-preference-centre",
               "app-donor-360", "app-donor-identity-verification", "app-donor-list", "app-duplicate-review",
               "app-follow-up-execution", "app-follow-up-planner", "app-follow-up-queue", "app-lead-capture",
               "app-lead-capture-confirm", "app-lead-work-queue", "app-my-leads"],
    "finance": ["app-finance-exception-case", "app-finance-workbench", "app-financial-correction-or-reversal",
                "app-maker-checker-review", "app-offline-donation-entry", "app-period-campaign-close",
                "app-reconciliation-workspace", "app-settlement-batch-detail"],
    "inventory": ["app-batch-ledger", "app-inventory-exception-queue", "app-inventory-overview",
                  "app-reservation-manager", "app-stock-adjustment-approval", "app-stock-count-session",
                  "app-stock-movement-form", "app-warehouse-transfer"],
    "masters": ["app-city", "app-country", "app-currency", "app-state", "app-time-zone"],
    "platform": ["app-business-unit", "app-menu-catalogue", "app-permission-catalogue"],
    "organisation": ["app-organisation-owner-view", "app-verification-approval", "app-organisation-detail",
                     "app-organisation-details", "app-department-form"],
    "workspace": ["app-executive-dashboard", "app-global-search", "app-work-space", "app-notification-centre",
                  "app-role-aware-application-shell", "app-saved-view-builder", "app-standard-list-page",
                  "app-standard-record-detail"],
}
ALL_HOSTS = [h for hs in MODULES.values() for h in hs]
PREFIX = f":is({', '.join(ALL_HOSTS)}) "


def M(mod):
    return f":is({', '.join(MODULES[mod])})"


# ------------------------------------------------------------------------------------------------ registries
SCRIMS = [
    ".ar-backdrop", ".modal-overlay", ".mc-modal-backdrop", ".oc-overlay",
    ".msec-modal-backdrop", ".msec-backdrop", ".rx-overlay", ".modal-backdrop", ".dir-overlay",
    ".up-backdrop", ".sec-modal-overlay", "app-communication-exception-queue .scrim",
    "app-sla-policy-calendar .overlay", "app-outbound-message-composer .overlay", ".panel-backdrop",
    ".drawer-overlay", ".drawer-backdrop", ".pr-modal-backdrop", ".pr-detail-backdrop", ".dialog-backdrop",
    ".ab-drawer-backdrop", ".ab-modal-backdrop", ".ct-overlay", "app-communication-timeline .backdrop",
    ".dl-drawer-backdrop", ".fq-scrim", ".offcanvas-backdrop", ".ode-modal-backdrop",
    ".pci-modal-backdrop", ".rwn-offcanvas-backdrop", ".rwn-modal-backdrop", ".sb-modal-backdrop",
    ".gm-overlay", ".gs-modal-backdrop", ".nc-modal-scrim", ".sh-modal-backdrop",
    ".svb-modal-backdrop", ".slp-modal-backdrop", ".srd-modal-backdrop", ".dl-modal-backdrop",
    ".org-modal-backdrop", ".df-backdrop",
]
# Scrims that fade themselves in and out with opacity / visibility (checkbox-driven): colour only.
SCRIMS_COLOUR_ONLY = [".filter-modal-backdrop"]

DIALOGS = [
    ".ar-modal", ".bu-modal", ".modal-modern", ".mc-modal", ".msec-modal:not(.modal)",
    ".rx-modal", ".modal-content", ".dir-dialog", ".up-modal", ".sec-modal",
    ".modal:not(.d-block):not(.fade):not(.modal-split):not(:has(> .modal-dialog))",
    "app-payment-gateway-configuration .modal-dialog", ".pr-modal",
    "app-public-donation-initiation .dialog", ".ab-modal", ".ct-modal", "dialog.action-dialog",
    ".execution-modal", ".fup-confirm-dialog", ".fq-modal", ".ode-modal", ".pci-modal", ".rwn-modal",
    ".sb-modal", ".gm-dialog", ".gs-modal", ".nc-modal", ".sh-modal:not(.sh-palette)",
    ".svb-modal", ".slp-modal", ".srd-modal", ".dl-modal", ".success-modal",
    "app-outbound-message-composer .review-panel", ".filter-modal", ".org-modal", ".df-dialog",
]
# Narrow confirmations and results.
DIALOGS_SM = [".gm-dialog", ".success-modal", ".org-modal", ".ct-modal-sm", ".ar-modal--result", ".dl-modal",
              ".review-panel--narrow", ".sh-modal", ".gs-modal", ".svb-modal", ".filter-modal"]
# Dialogs that carry a form or a comparison and need room.
DIALOGS_LG = [".ar-modal--lg", ".up-modal--lg", ".rx-modal--wide", ".execution-modal", ".bu-modal",
              "app-outbound-message-composer .review-panel:not(.review-panel--narrow)", ".fq-modal",
              "app-duplicate-review .modal", "dialog.action-dialog", ".modal-modern"]

DRAWERS = [
    ".dir-sheet", "app-menu-configuration .oc", "app-role-catalogue .rx-oc", "app-communication-exception-queue .drawer",
    "app-sla-policy-calendar .drawer", "app-template-catalogue .drawer",
    "app-suppression-and-contact-restriction .side-panel", "app-payment-gateway-configuration .details-pane",
    ".pr-detail", ".ab-drawer", ".ct-drawer", "app-communication-timeline .offcanvas", ".dl-drawer",
    ".fq-drawer", "dialog.lq-drawer", ".lead-offcanvas", ".rwn-offcanvas",
]
# Drawers that slide in and out with their own transform: no entry animation from this layer.
DRAWERS_SELF_ANIMATED = ["app-communication-timeline .offcanvas"]

HEAD = (':is([class*="-head"]:not([class*="-heading"]), [class*="__head"], [class*="-header"], [class*="__header"], '
        '[class*="-modal-top"], [class*="__top"], .modal-header, .dir-sheet-hero)')
BODY = ':is([class*="-body"], [class*="__body"], .modal-body)'
FOOT = (':is([class*="-foot"], [class*="__foot"], [class*="-footer"], [class*="__footer"], '
        '[class*="-actions"]:not([class*="-actions-"]), [class*="__actions"], .modal-footer, .button-row)')
TITLE = ':is(h1, h2, h3, h4, h5, [class*="-title"]:not([class*="-titles"]), [class*="__title"])'
LEAD = (':is([class*="-lead"], [class*="__lead"], [class*="-lede"], [class*="__lede"], [class*="-sub"]:not([class*="-subtle"]), '
        '[class*="__sub"], [class*="-context"], [class*="__consequence"], [class*="-text"]:not([class*="-textarea"]))')
CLOSE = (':is([class*="-close"], [class*="__close"], [class*="-x"]:not([class*="-xl"]), .btn-close, .icon-close, '
         '.icon-btn, .btn--icon, [aria-label^="Close"], [aria-label^="close"])')
GLYPH = ':is([class*="-icon"], [class*="-ic"])'

NL = ",\n"


def G(items, prefix=PREFIX):
    return f"{prefix}:is({', '.join(items)})"


def _descends(sel):
    """True when `sel` has a descendant or child combinator outside any brackets."""
    sel = sel.strip()
    depth = 0
    for i, ch in enumerate(sel):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif depth == 0 and ch == ">":
            return True
        elif depth == 0 and ch == " ":
            before = sel[:i].rstrip()[-1:]
            after = sel[i:].lstrip()[:1]
            if before not in ("+", "~", ">") and after not in ("+", "~", ">"):
                return True
    return False


def within(roots, rest):
    """`rest` under each grouped root; rest may hold several complex selectors joined by '|'."""
    if isinstance(roots, str):
        roots = [roots]
    parts = rest.split("|")
    # `root > :is(x, y)` is only right while x and y are single elements (sibling combinators are fine):
    # a part that walks down the tree (`body section > h3`) must keep its own `root > ...` selector.
    if len(parts) > 1 and all(p.startswith(" > ") and not _descends(p[3:]) for p in parts):
        inner = ", ".join(p[3:] for p in parts)
        return NL.join(f"{r} > :is({inner})" for r in roots)
    if len(parts) > 1 and all(p.startswith(" ") and not p.startswith(" >") for p in parts):
        inner = ", ".join(p[1:] for p in parts)
        return NL.join(f"{r} :is({inner})" for r in roots)
    return NL.join(f"{r}{x}" for r in roots for x in parts)


def rule(selector, body):
    body = textwrap.dedent(body).strip("\n")
    body = "\n".join("  " + l if l.strip() else l for l in body.splitlines())
    return f"{selector} {{\n{body}\n}}\n"


def comment(text):
    return f"/* {text} */\n"


def section(title):
    return ("\n/* =========================================================================================\n"
            f"   {title}\n"
            "   ========================================================================================= */\n")


D, W = DIALOGS, DRAWERS
Dl = ", ".join(D)
# A native <dialog> that is closed must stay hidden: never style it until it is [open]. A dialog carrying
# `data-dg-own` has a bespoke design in its own component (Donor 360's "Record a pledge" note) and every rule
# here except the scrim leaves it alone.
SHUT = ":not(dialog:not([open])):not([data-dg-own])"


def roots(prefix=PREFIX):
    """The dialog / drawer root groups under a host prefix."""
    shut = SHUT
    return {
        "D": f"{prefix}:is({Dl}){shut}",
        "W": f"{prefix}:is({', '.join(W)}){shut}",
        "FLAT": f"{prefix}:is({Dl}){shut}:not(:has(> {HEAD}))",
        "STRUCT": f"{prefix}:is({Dl}){shut}:has(> {HEAD})",
        "WITHBODY": f"{prefix}:is({Dl}){shut}:has(> {BODY})",
        "NOBODY": f"{prefix}:is({Dl}){shut}:not(:has(> {BODY}))",
    }


R = roots()
_D, _W, FLAT, STRUCT, WITHBODY, NOBODY = R["D"], R["W"], R["FLAT"], R["STRUCT"], R["WITHBODY"], R["NOBODY"]
BOTH = [_D, _W]
HEADS = [STRUCT, _W]
ANY = [STRUCT, _W, FLAT]

FLAT_TITLE = f" > {TITLE}:first-child| > :is({GLYPH}, {CLOSE}):first-child + {TITLE}"
FLAT_LEAD = f" > {TITLE}:first-child + :is({LEAD}, p)| > :is({GLYPH}, {CLOSE}):first-child + {TITLE} + :is({LEAD}, p)"
FLAT_BAND = (f" > {TITLE}:first-child| > {TITLE}:first-child + :is({LEAD}, p)| > :is({GLYPH}, {CLOSE}):first-child"
             f"| > :is({GLYPH}, {CLOSE}):first-child + {TITLE}| > :is({GLYPH}, {CLOSE}):first-child + {TITLE} + :is({LEAD}, p)")
FLAT_BAND_LAST = (f" > {TITLE}:first-child:not(:has(+ :is({LEAD}, p)))| > {TITLE}:first-child + :is({LEAD}, p)"
                  f"| > :is({GLYPH}, {CLOSE}):first-child + {TITLE}:not(:has(+ :is({LEAD}, p)))"
                  f"| > :is({GLYPH}, {CLOSE}):first-child + {TITLE} + :is({LEAD}, p)")
BTN = f" > {FOOT} :is(button, a[class*=\"btn\"]):not({CLOSE}):not([class*=\"link\"]):not([role=\"switch\"])"
PRIMARY_BTN = BTN + ":is([class*=\"primary\"], [class*=\"cta\"], [class*=\"tone\"], [type=\"submit\"]):not([class*=\"outline\"]):not([class*=\"danger\"]):not([class*=\"warn\"])"
SECONDARY_BTN = BTN + ":not([class*=\"primary\"]):not([class*=\"danger\"]):not([class*=\"warn\"]):not([class*=\"tone\"]):not([class*=\"cta\"]):not([type=\"submit\"])"
DANGER_BTN = BTN + "[class*=\"danger\"]:not([class*=\"outline\"])"
CTRL = (" :is(textarea, select, input:is([type=\"text\"], [type=\"date\"], [type=\"time\"], [type=\"datetime-local\"], "
        "[type=\"search\"], [type=\"email\"], [type=\"number\"], [type=\"tel\"], [type=\"url\"], [type=\"password\"], :not([type])))"
        # Controls that are one part of a composite control (a phone code + number pair, a stepper, a search
        # box with its icon, a locked field) keep the composite's own frame.
        ":not(:is([class*=\"phone\"], [class*=\"locked\"], [class*=\"stepper\"], [class*=\"search\"], [class*=\"combo\"], "
        "[class*=\"input-group\"], [class*=\"picker\"]) > *)")
DL_ROWS = " dl:has(> div > dt):not(:is(table, [class*=\"grid\"]) dl)"
DL_FLAT = " dl:has(> dt):not(:has(> div)):not(:is(table, [class*=\"grid\"]) dl)"

css = []
css.append("""/* =====================================================================================================
   YDot Dialogs - pop-ups (dialogs) and off-canvas panels (drawers) for every module EXCEPT Campaigns and
   Organisation, which keep their own designs.

   GENERATED - do not edit by hand. Source: tools/generate-dialog-styles.py (run it from UI/YDots.UI).

   ONE DESIGN PER MODULE, NO FILLED BLOCKS. Every header, sheet and footer is white; each module is told apart
   by its rules, corners, type and glyph treatment - never by a dark or tinted slab:
     Administration      "Folio"          - a theme bar down the header's left edge, display-face title, 14px sheet.
     Communications      "Correspondence" - warm paper, a theme rule across the top, serif title with an italic
                                            lead, dotted rules, pill buttons, drawers as a floating card.
     Configuration       "Blueprint"      - a hairline frame, a full-width 2px theme rule under the header, a faint
                                            outlined ring in the header corner, 8px corners.
     Donations/Payments  "Receipt"        - centred header round a dashed-ring glyph, perforated (dashed) divider,
                                            figures in the number face, full-width paired buttons.
     Donors & Leads      "Aurora"         - generous 24px corners, the glyph in a thin theme ring, pill buttons,
                                            floating rounded drawers.
     Finance             "Ledger"         - crisp 8px corners, double rules round the header and footer, dotted
                                            ledger leaders with right-aligned tabular figures, small-caps buttons.
     Inventory           "Spec sheet"     - square corners, an uppercase stamped title over a 2px ink rule,
                                            facts in a bordered spec grid, a light unblurred scrim.
     Masters             "Medallion"      - everything centred round an outlined circular glyph medallion,
                                            equal-width buttons.
     Organisation        "Charter"        - a gold hairline under the header with a small diamond at its centre,
                                            display-face title, gold eyebrow and glyph.
     Platform            "Frame"          - a white sheet in a 2px theme frame, a short accent under the title,
                                            outlined secondary buttons in the theme colour.
     Workspace           "Glass"          - a frosted translucent sheet, a gradient hairline across the top,
                                            compact controls, a strongly blurred light scrim.

   HOW. A shared base (sections 1-9) lays out every dialog and drawer by ROLE - head, body, footer, title, lead,
   facts, fields, buttons - and reads every visual decision from --dg-* custom properties. Section 10 sets those
   properties per module on the module's host elements (they inherit into the dialogs) and adds the few rules
   a design needs beyond them.

   Screens name their parts differently, so the registries in the generator list each screen's scrim, dialog
   and drawer classes; the parts inside are found by name:
       head   = a direct child named *-head / *-header / *__header / *-modal-top / .modal-header
       body   = a direct child named *-body / *__body / .modal-body
       footer = a direct child named *-foot / *-footer / *-actions / *__actions / .modal-footer
   A dialog without a head wrapper gets the same header: its title and lead become the band.

   Component styles are emulated (.x[_ngcontent-...]) and several use !important, hence !important on the
   declarations that must win. The app is flat by request: no drop shadows. Sizes follow --ui-scale.
   ===================================================================================================== */

:root {
  --dg-s: var(--ui-scale, 1);
  --dg-accent: var(--theme-primary, #375c4c);
  --dg-accent-ink: color-mix(in srgb, var(--theme-primary, #375c4c) 80%, #000000);
  --dg-deep: var(--theme-deep, #13221b);
  --dg-ink: var(--theme-ink, #1c2a24);
  --dg-muted: var(--theme-muted, #5d6b64);
  --dg-danger: #b3261e;
  --dg-warn: #a8660d;
  --dg-line: color-mix(in srgb, var(--theme-primary, #375c4c) 13%, #e4e8e6);
  --dg-line-soft: color-mix(in srgb, var(--theme-primary, #375c4c) 7%, #eef0ef);
  --dg-w-sm: min(calc(460px * var(--dg-s)), calc(100vw - 32px));
  --dg-w-md: min(calc(580px * var(--dg-s)), calc(100vw - 32px));
  --dg-w-lg: min(calc(860px * var(--dg-s)), calc(100vw - 32px));
}

/* Base values: every module overrides most of them in section 10. */
""" + PREFIX.strip() + """ {
  --dg-pad: calc(26px * var(--dg-s));
  --dg-radius: calc(20px * var(--dg-s));
  --dg-surface: #ffffff;
  --dg-border: 1px solid var(--dg-line);
  --dg-border-top: var(--dg-border);
  --dg-scrim: color-mix(in srgb, var(--dg-deep) 46%, transparent);
  --dg-blur: calc(7px * var(--dg-s));
  --dg-anim: dg-pop;
  --dg-band-bg: #ffffff;
  --dg-band-ink: var(--dg-ink);
  --dg-band-muted: var(--dg-muted);
  --dg-band-rule: 1px solid var(--dg-line);
  --dg-band-align: left;
  --dg-band-pt: calc(22px * var(--dg-s));
  --dg-band-pb: calc(18px * var(--dg-s));
  --dg-glyph: var(--dg-accent);
  --dg-eyebrow: var(--dg-accent);
  --dg-title-font: var(--font-display, inherit);
  --dg-title-size: calc(21px * var(--dg-s));
  --dg-title-weight: 700;
  --dg-title-case: none;
  --dg-title-track: -0.01em;
  --dg-lead-style: normal;
  --dg-close-bg: #ffffff;
  --dg-close-border: 1px solid var(--dg-line);
  --dg-close-ink: var(--dg-muted);
  --dg-close-radius: calc(11px * var(--dg-s));
  --dg-body-bg: transparent;
  --dg-gap: calc(20px * var(--dg-s));
  --dg-sheet-bg: #ffffff;
  --dg-quiet-bg: #f6f7f6;
  --dg-sheet-border: 1px solid var(--dg-line);
  --dg-sheet-radius: calc(14px * var(--dg-s));
  --dg-row-rule: 1px solid var(--dg-line-soft);
  --dg-value-font: inherit;
  --dg-field-radius: calc(12px * var(--dg-s));
  --dg-field-bg: #ffffff;
  --dg-field-line: color-mix(in srgb, var(--dg-accent) 20%, #d9dfdc);
  --dg-foot-bg: #ffffff;
  --dg-foot-rule: 1px solid var(--dg-line);
  --dg-foot-justify: flex-end;
  --dg-btn-h: calc(42px * var(--dg-s));
  --dg-btn-radius: calc(12px * var(--dg-s));
  --dg-btn-size: calc(14px * var(--dg-s));
  --dg-btn-case: none;
  --dg-btn-track: 0;
  --dg-btn-flex: 0 1 auto;
  --dg-primary-bg: var(--dg-accent);
  --dg-primary-hover: var(--dg-accent-ink);
  --dg-primary-ink: #ffffff;
  --dg-secondary-bg: #ffffff;
  --dg-secondary-border: var(--dg-line);
  --dg-secondary-ink: var(--dg-ink);
  --dg-drawer-w: min(calc(540px * var(--dg-s)), 100vw);
  --dg-drawer-inset: 0px;
  --dg-drawer-radius: var(--dg-radius) 0 0 var(--dg-radius);
}

@keyframes dg-fade { from { opacity: 0; } to { opacity: 1; } }
/* `translate` / `scale` (not `transform`), so a dialog that centres itself with transform keeps its place. */
@keyframes dg-pop {
  from { opacity: 0; translate: 0 calc(12px * var(--dg-s)); scale: .98; }
  to   { opacity: 1; translate: 0 0; scale: 1; }
}
@keyframes dg-drop {
  from { opacity: 0; translate: 0 calc(-18px * var(--dg-s)); }
  to   { opacity: 1; translate: 0 0; }
}
@keyframes dg-zoom {
  from { opacity: 0; scale: .92; }
  to   { opacity: 1; scale: 1; }
}
@keyframes dg-rise {
  from { opacity: 0; translate: 0 calc(28px * var(--dg-s)); }
  to   { opacity: 1; translate: 0 0; }
}
@keyframes dg-slide {
  from { opacity: .3; translate: calc(48px * var(--dg-s)) 0; }
  to   { opacity: 1; translate: 0 0; }
}
""")

# ---------------------------------------------------------------- 1. scrim
css.append(section("1. SCRIM"))
css.append(rule(G(SCRIMS) + NL + G(SCRIMS_COLOUR_ONLY) + NL +
                f"{PREFIX}dialog:is(.action-dialog, .execution-modal, .fup-confirm-dialog, .lq-drawer)::backdrop", """
    background-color: var(--dg-scrim) !important;
    -webkit-backdrop-filter: blur(var(--dg-blur)) saturate(120%);
    backdrop-filter: blur(var(--dg-blur)) saturate(120%);
    """))
css.append(rule(G(SCRIMS), "animation: dg-fade .2s ease both;"))
css.append(comment("Every pop-up layer sits above the app's top bar (z-index 1001): scrim, then the sheet on it."))
css.append(rule(G(SCRIMS), "z-index: 1060 !important;"))
css.append(comment("Bootstrap's backdrop dims itself to .5; the scrim colour already carries its strength."))
css.append(rule(f"{PREFIX}.modal-backdrop.show", "opacity: 1 !important;"))

# ---------------------------------------------------------------- 2. surface
css.append(section("2. DIALOG SURFACE - a column of full-width parts, three widths"))
css.append(rule(_D, """
    width: var(--dg-w-md) !important;
    max-width: calc(100vw - 32px) !important;
    max-height: min(90vh, calc(900px * var(--dg-s))) !important;
    max-height: min(90dvh, calc(900px * var(--dg-s))) !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    justify-items: stretch !important;
    justify-content: flex-start !important;
    gap: 0 !important;
    padding: 0 !important;
    border: var(--dg-border) !important;
    border-top: var(--dg-border-top) !important;
    border-radius: var(--dg-radius) !important;
    background: var(--dg-surface) !important;
    box-shadow: none !important;
    color: var(--dg-ink);
    text-align: left !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--dg-accent) 28%, transparent) transparent;
    """))
css.append(rule(G([d for d in D if d != ".filter-modal"]) + SHUT, "animation: var(--dg-anim) .28s cubic-bezier(.2, .8, .2, 1) both;"))
css.append(comment("Size variants repeat the dialog list so they outrank the base rule (an :is() takes the "
                   "specificity of its most specific entry)."))
css.append(rule(f"{PREFIX}:is({Dl}):is({', '.join(DIALOGS_SM)}){SHUT}", "width: var(--dg-w-sm) !important;"))
css.append(rule(f"{PREFIX}:is({Dl}):is({', '.join(DIALOGS_LG)}){SHUT}", "width: var(--dg-w-lg) !important;"))
css.append(rule(within(_D, " > *"), """
    align-self: stretch !important;
    justify-self: stretch !important;
    width: auto !important;
    max-width: none !important;
    flex-shrink: 0;
    """))
css.append(comment("Screens whose dialog box is itself called .modal also match Bootstrap's .modal (a fixed, full-screen, "
                   "hidden wrapper). Undo that so the box sits centred in its own backdrop."))
css.append(rule(f"{PREFIX}.modal:not(.d-block):not(.fade):not(:has(> .modal-dialog))", "height: auto !important;"))
css.append(rule(f"{PREFIX}:is([class*=\"backdrop\"], [class*=\"overlay\"]) > .modal:not(.d-block):not(.fade):not(:has(> .modal-dialog))", """
    position: relative !important;
    inset: auto !important;
    z-index: auto;
    """))
css.append(comment("Bootstrap dialogs: the width lives on .modal-dialog; the rounded sheet is .modal-content."))
css.append(rule(f"{PREFIX}.modal-dialog:has(> .modal-content)", """
    max-width: var(--dg-w-md) !important;
    width: var(--dg-w-md);
    margin-inline: auto !important;
    """))
css.append(rule(f"{PREFIX}.modal-dialog.modal-lg:has(> .modal-content)", """
    max-width: var(--dg-w-lg) !important;
    width: var(--dg-w-lg);
    """))
css.append(rule(f"{PREFIX}.modal-dialog > .modal-content", "width: 100% !important;"))
css.append(comment("With a body wrapper only the body scrolls, between a fixed head and footer."))
css.append(rule(WITHBODY, "overflow: hidden !important;"))
css.append(rule(within(WITHBODY, f" > {BODY}"), """
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto !important;
    scrollbar-width: thin;
    """))

# ---------------------------------------------------------------- 3. header
css.append(section("3. HEADER - a head wrapper is the band; without one, the title / lead (and a glyph or close "
                   "button in front of them) are the band"))
css.append(rule(within(HEADS, f" > {HEAD}"), """
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: calc(14px * var(--dg-s));
    margin: 0 !important;
    min-height: 0 !important;
    padding: var(--dg-band-pt) calc(var(--dg-pad) + calc(46px * var(--dg-s))) var(--dg-band-pb) var(--dg-pad) !important;
    border: 0 !important;
    border-bottom: var(--dg-band-rule) !important;
    border-radius: 0 !important;
    background: var(--dg-band-bg) !important;
    color: var(--dg-band-ink) !important;
    text-align: var(--dg-band-align) !important;
    """))
css.append(comment("A head followed by a loose lead: the lead continues the band and closes it."))
css.append(rule(within(STRUCT, f" > {HEAD}:has(+ :is({LEAD}, p))"), """
    border-bottom: 0 !important;
    padding-bottom: 0 !important;
    """))
css.append(rule(within(STRUCT, f" > {HEAD} + :is({LEAD}, p)"), """
    margin: 0 0 var(--dg-gap) !important;
    padding: calc(8px * var(--dg-s)) calc(var(--dg-pad) + calc(46px * var(--dg-s))) var(--dg-band-pb) var(--dg-pad) !important;
    border-bottom: var(--dg-band-rule) !important;
    background: var(--dg-band-bg) !important;
    font-size: calc(14px * var(--dg-s)) !important;
    font-style: var(--dg-lead-style);
    line-height: 1.55 !important;
    color: var(--dg-band-muted) !important;
    text-align: var(--dg-band-align) !important;
    """))
css.append(rule(within(NOBODY, f" > {HEAD}:not(:has(+ :is({LEAD}, p)))"), "margin-bottom: var(--dg-gap) !important;"))
css.append(comment("Every loose child (not head, body or footer) sits on the gutters ..."))
css.append(rule(within(_D, f" > :not({HEAD}):not({FOOT}):not({BODY}):not({HEAD} + :is({LEAD}, p))"), """
    margin-left: var(--dg-pad) !important;
    margin-right: var(--dg-pad) !important;
    """))
css.append(comment("... except, in a dialog without a head wrapper, the band parts, which run edge to edge."))
css.append(rule(within(FLAT, FLAT_BAND), """
    margin: 0 !important;
    padding-left: var(--dg-pad) !important;
    padding-right: calc(var(--dg-pad) + calc(40px * var(--dg-s))) !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: var(--dg-band-bg) !important;
    text-align: var(--dg-band-align) !important;
    """))
css.append(rule(within(FLAT, " > :first-child"), "padding-top: var(--dg-band-pt) !important;"))
css.append(rule(within(FLAT, FLAT_BAND_LAST), """
    padding-bottom: var(--dg-band-pb) !important;
    margin-bottom: var(--dg-gap) !important;
    border-bottom: var(--dg-band-rule) !important;
    """))
css.append(rule(within(FLAT, f" > {TITLE}:first-child + :is({LEAD}, p)| > :is({GLYPH}, {CLOSE}):first-child + {TITLE}"
                             f"| > :is({GLYPH}, {CLOSE}):first-child + {TITLE} + :is({LEAD}, p)"),
                "padding-top: calc(6px * var(--dg-s)) !important;"))
css.append(rule(within(FLAT, f" > {GLYPH}:first-child + {TITLE}"), "padding-top: calc(12px * var(--dg-s)) !important;"))
css.append(comment("A dialog that is only a header and buttons: the header runs straight into the footer."))
css.append(rule(within(ANY, f" > :is({HEAD}, {TITLE}, {LEAD}, p):has(+ {FOOT})"), "margin-bottom: 0 !important;"))

css.append(comment("Typography of the header parts."))
css.append(rule(within(HEADS, f" > {HEAD} {TITLE}:not({HEAD} :is(section, dl, ul, li, table) *)") + NL + within(FLAT, FLAT_TITLE), """
    margin: 0 !important;
    font-family: var(--dg-title-font) !important;
    font-size: var(--dg-title-size) !important;
    font-weight: var(--dg-title-weight) !important;
    line-height: 1.25 !important;
    letter-spacing: var(--dg-title-track) !important;
    text-transform: var(--dg-title-case) !important;
    color: var(--dg-band-ink) !important;
    text-align: var(--dg-band-align) !important;
    """))
css.append(rule(within(HEADS, f" > {HEAD} :is({LEAD}, {TITLE} + p)"), "margin: calc(6px * var(--dg-s)) 0 0 !important;"))
css.append(rule(within(HEADS, f" > {HEAD} :is({LEAD}, {TITLE} + p)") + NL + within(FLAT, FLAT_LEAD), """
    font-size: calc(14px * var(--dg-s)) !important;
    font-weight: 400 !important;
    font-style: var(--dg-lead-style);
    line-height: 1.55 !important;
    color: var(--dg-band-muted) !important;
    text-align: var(--dg-band-align) !important;
    """))
css.append(rule(within(HEADS, f" > {HEAD} :is([class*=\"eyebrow\"], [class*=\"kicker\"], [class*=\"-step\"])"), """
    margin: 0 0 calc(6px * var(--dg-s)) !important;
    font-size: calc(11px * var(--dg-s)) !important;
    font-weight: 700 !important;
    letter-spacing: .12em !important;
    text-transform: uppercase !important;
    color: var(--dg-eyebrow) !important;
    """))
css.append(comment("Glyphs in the header: the module's glyph colour, no tile (the app strips icon tiles)."))
css.append(rule(within(HEADS, f" > {HEAD} > {GLYPH}:not(button):not({CLOSE})"), """
    flex: none;
    display: grid !important;
    place-items: center;
    width: calc(40px * var(--dg-s)) !important;
    height: calc(40px * var(--dg-s)) !important;
    margin: 0 !important;
    color: var(--dg-glyph) !important;
    font-size: calc(24px * var(--dg-s)) !important;
    """))
css.append(rule(within(FLAT, f" > {GLYPH}:first-child"), """
    display: flex !important;
    justify-content: var(--dg-band-align) !important;
    width: auto !important;
    height: auto !important;
    color: var(--dg-glyph) !important;
    font-size: calc(26px * var(--dg-s)) !important;
    """))
css.append(rule(within(HEADS, f" > {HEAD} > {GLYPH}:not(button):not({CLOSE}) svg") + NL + within(FLAT, f" > {GLYPH}:first-child svg"), """
    width: calc(28px * var(--dg-s)) !important;
    height: calc(28px * var(--dg-s)) !important;
    """))
css.append(rule(within(HEADS, f" > {HEAD} > {GLYPH}:is([class*=\"danger\"], [class*=\"error\"])") + NL +
                within(FLAT, f" > {GLYPH}:first-child:is([class*=\"danger\"], [class*=\"error\"])"),
                "color: var(--dg-danger) !important;"))
css.append(rule(within(HEADS, f" > {HEAD} > {GLYPH}[class*=\"warn\"]") + NL + within(FLAT, f" > {GLYPH}:first-child[class*=\"warn\"]"),
                "color: var(--dg-warn) !important;"))

css.append(comment("Close button: a quiet square in the header's top-right corner."))
CLOSE_SEL = (within(HEADS, f" > {HEAD} {CLOSE}:is(button, a)| > {CLOSE}:is(button, a)| > [class*=\"close-row\"] {CLOSE}")
             + NL + within(FLAT, f" > {CLOSE}:is(button, a)"))
css.append(rule(CLOSE_SEL, """
    position: absolute !important;
    top: calc(18px * var(--dg-s)) !important;
    right: calc(18px * var(--dg-s)) !important;
    left: auto !important;
    z-index: 5;
    width: calc(36px * var(--dg-s)) !important;
    min-width: 0 !important;
    height: calc(36px * var(--dg-s)) !important;
    min-height: 0 !important;
    display: inline-grid !important;
    place-items: center !important;
    margin: 0 !important;
    padding: 0 !important;
    border: var(--dg-close-border) !important;
    border-radius: var(--dg-close-radius) !important;
    background-color: var(--dg-close-bg) !important;
    color: var(--dg-close-ink) !important;
    font-size: calc(16px * var(--dg-s)) !important;
    line-height: 1 !important;
    box-shadow: none !important;
    opacity: 1 !important;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease, border-color .15s ease, rotate .2s ease;
    """))
css.append(rule(within(ANY, f" {CLOSE}:is(button, a):hover"), "rotate: 90deg;"))
css.append(rule(within(ANY, f" {CLOSE}:is(button, a) svg"), """
    width: calc(16px * var(--dg-s)) !important;
    height: calc(16px * var(--dg-s)) !important;
    """))
css.append(rule(within(HEADS, " .btn-close"), """
    background-size: calc(11px * var(--dg-s)) !important;
    background-position: center !important;
    background-repeat: no-repeat !important;
    """))
css.append(comment("The row that only held the close button collapses: the button floats in the band."))
css.append(rule(within(_W, " > [class*=\"close-row\"]"), """
    height: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    """))

# ---------------------------------------------------------------- 4. body
css.append(section("4. BODY - gutters, rhythm and type"))
css.append(rule(within(HEADS, f" > {BODY}"), """
    margin: 0 !important;
    padding: calc(22px * var(--dg-s)) var(--dg-pad) !important;
    border: 0 !important;
    background: var(--dg-body-bg) !important;
    color: var(--dg-ink);
    font-size: calc(14px * var(--dg-s));
    line-height: 1.55;
    text-align: left;
    """))
css.append(rule(within(_W, f" > {BODY}"), """
    flex: 1 1 auto !important;
    min-height: 0 !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    scrollbar-width: thin;
    """))
css.append(rule(within(HEADS, f" > {BODY} :is(section, [class*=\"-section\"], [class*=\"-sec\"], [class*=\"-group\"]) > :is(h3, h4, h5, [class*=\"-title\"]):first-child"
                              f"| > :is(section, [class*=\"-section\"]) > :is(h3, h4, h5):first-child"), """
    display: flex !important;
    align-items: center;
    gap: calc(10px * var(--dg-s));
    margin: 0 0 calc(12px * var(--dg-s)) !important;
    font-family: var(--font-heading, inherit) !important;
    font-size: calc(11.5px * var(--dg-s)) !important;
    font-weight: 700 !important;
    letter-spacing: .1em !important;
    text-transform: uppercase !important;
    color: var(--dg-muted) !important;
    """))
# Pseudo-elements cannot sit inside :is(), so the two heading shapes are listed separately.
css.append(rule(NL.join([
    within(HEADS, f" > {BODY} :is(section, [class*=\"-section\"], [class*=\"-sec\"], [class*=\"-group\"]) > :is(h3, h4, h5, [class*=\"-title\"]):first-child::after"),
    within(HEADS, " > :is(section, [class*=\"-section\"]) > :is(h3, h4, h5):first-child::after")]), """
    content: '';
    flex: 1 1 auto;
    height: 1px;
    background: var(--dg-line-soft);
    """))
css.append(comment("No box inside a box: a titled section in a body is spaced and headed, not framed and filled."))
css.append(rule(within(HEADS, f" > {BODY} section:has(> :is(h3, h4, h5, h6, [class*=\"-title\"]):first-child)"), """
    margin: 0 0 calc(22px * var(--dg-s)) !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    """))
css.append(rule(within(HEADS, f" > {BODY} section:has(> :is(h3, h4, h5, h6, [class*=\"-title\"]):first-child):last-child"),
                "margin-bottom: 0 !important;"))
css.append(comment("A header made of stacked rows (a bar, then an identity block) stacks instead of sitting side by side."))
css.append(rule(within(HEADS, " > .dir-sheet-hero"), """
    flex-direction: column !important;
    align-items: stretch !important;
    gap: calc(12px * var(--dg-s)) !important;
    """))
css.append(comment("Drawers whose sections are direct children (no body wrapper) sit on the same gutters."))
css.append(rule(within(_W, f" > :not({HEAD}):not({BODY}):not({FOOT}):not([class*=\"close-row\"]):not(dl)"), """
    margin-left: var(--dg-pad) !important;
    margin-right: var(--dg-pad) !important;
    """))
css.append(rule(within(_W, f" > {HEAD} + :not({BODY}):not({FOOT})"), "margin-top: var(--dg-gap) !important;"))
css.append(comment("Bootstrap fact tiles (.bg-light boxes) read as cells of the summary sheet."))
css.append(rule(within(BOTH, " .bg-light:not(button):not(.btn)"), """
    background: #ffffff !important;
    border: 1px solid var(--dg-line) !important;
    border-radius: var(--dg-sheet-radius) !important;
    """))

# ---------------------------------------------------------------- 5. summary sheet
css.append(section("5. SUMMARY SHEET - record facts (<dl> of dt / dd rows): label left, value right"))
css.append(rule(within(BOTH, DL_ROWS), """
    display: block !important;
    margin-top: 0 !important;
    margin-bottom: calc(20px * var(--dg-s)) !important;
    padding: 2px 0 !important;
    border: var(--dg-sheet-border) !important;
    border-radius: var(--dg-sheet-radius) !important;
    background: var(--dg-sheet-bg) !important;
    overflow: hidden;
    """))
css.append(rule(within(BOTH, DL_ROWS + " > div"), """
    display: grid !important;
    grid-template-columns: minmax(calc(120px * var(--dg-s)), 38%) minmax(0, 1fr) !important;
    align-items: baseline;
    gap: calc(4px * var(--dg-s)) calc(18px * var(--dg-s)) !important;
    margin: 0 !important;
    padding: calc(11px * var(--dg-s)) calc(18px * var(--dg-s)) !important;
    border: 0 !important;
    border-top: var(--dg-row-rule) !important;
    background: transparent !important;
    """))
css.append(rule(within(BOTH, DL_ROWS + " > div:first-child"), "border-top: 0 !important;"))
css.append(rule(within(BOTH, DL_FLAT), """
    display: grid !important;
    grid-template-columns: minmax(calc(120px * var(--dg-s)), 38%) minmax(0, 1fr) !important;
    gap: 0 !important;
    margin-top: 0 !important;
    margin-bottom: calc(20px * var(--dg-s)) !important;
    padding: calc(4px * var(--dg-s)) calc(18px * var(--dg-s)) !important;
    border: var(--dg-sheet-border) !important;
    border-radius: var(--dg-sheet-radius) !important;
    background: var(--dg-sheet-bg) !important;
    """))
css.append(rule(within(BOTH, DL_FLAT + " > :is(dt, dd)"), """
    padding: calc(9px * var(--dg-s)) 0 !important;
    border-top: var(--dg-row-rule);
    """))
css.append(rule(within(BOTH, DL_FLAT + " > :is(dt, dd):nth-child(-n + 2)"), "border-top: 0;"))
css.append(rule(within(BOTH, " dl:not(:is(table, [class*=\"grid\"]) dl) dt"), """
    margin: 0 !important;
    font-size: calc(13px * var(--dg-s)) !important;
    font-weight: 500 !important;
    color: var(--dg-muted) !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    """))
css.append(rule(within(BOTH, " dl:not(:is(table, [class*=\"grid\"]) dl) dd"), """
    margin: 0 !important;
    max-width: none !important;
    font-family: var(--dg-value-font) !important;
    font-size: calc(14px * var(--dg-s)) !important;
    font-weight: 600 !important;
    color: var(--dg-ink) !important;
    text-align: left !important;
    overflow-wrap: anywhere;
    """))

# ---------------------------------------------------------------- 6. fields
css.append(section("6. FIELDS - one label, one control, one focus ring"))
css.append(rule(within(BOTH, " :is(label:not(:has(input[type=\"checkbox\"], input[type=\"radio\"])), [class*=\"field-label\"], [class*=\"-label\"]:not(span):not([class*=\"-label-\"]), .form-label):not([class*=\"chip\"]):not([class*=\"pill\"]):not([class*=\"switch\"]):not([class*=\"check\"]):not([class*=\"radio\"]):not([class*=\"toggle\"])"), """
    font-size: calc(13px * var(--dg-s)) !important;
    font-weight: 600 !important;
    color: color-mix(in srgb, var(--dg-ink) 86%, #ffffff) !important;
    letter-spacing: .01em !important;
    text-transform: none !important;
    """))
css.append(rule(within(BOTH, CTRL), """
    min-height: calc(42px * var(--dg-s));
    border: 1px solid var(--dg-field-line) !important;
    border-radius: var(--dg-field-radius) !important;
    background-color: var(--dg-field-bg) !important;
    color: var(--dg-ink) !important;
    font-size: calc(14px * var(--dg-s)) !important;
    box-shadow: none !important;
    transition: border-color .15s ease, outline-color .15s ease, background-color .15s ease;
    """))
css.append(rule(within(BOTH, " textarea"), """
    min-height: calc(96px * var(--dg-s));
    padding: calc(11px * var(--dg-s)) calc(14px * var(--dg-s)) !important;
    line-height: 1.55 !important;
    resize: vertical;
    """))
css.append(rule(within(BOTH, CTRL + ":hover:not(:focus):not(:disabled)"), "border-color: color-mix(in srgb, var(--dg-accent) 42%, #cfd6d2) !important;"))
css.append(rule(within(BOTH, CTRL + ":focus"), """
    border-color: var(--dg-accent) !important;
    background-color: #ffffff !important;
    outline: calc(3px * var(--dg-s)) solid color-mix(in srgb, var(--dg-accent) 15%, transparent) !important;
    outline-offset: 0 !important;
    """))
css.append(rule(within(BOTH, CTRL + ":disabled") + NL + within(BOTH, " :is(input, textarea)[readonly]"), """
    background-color: var(--dg-quiet-bg) !important;
    color: var(--dg-muted) !important;
    """))

# ---------------------------------------------------------------- 7. footer
css.append(section("7. ACTION FOOTER - pinned to the bottom; the primary action solid, destructive red, the rest outlined"))
css.append(rule(within(ANY, f" > {FOOT}:not({HEAD} *)"), """
    position: sticky;
    bottom: 0;
    z-index: 3;
    flex: none;
    display: flex !important;
    flex-wrap: wrap;
    align-items: center;
    justify-content: var(--dg-foot-justify) !important;
    gap: calc(10px * var(--dg-s)) !important;
    width: auto !important;
    margin: calc(20px * var(--dg-s)) 0 0 !important;
    padding: calc(14px * var(--dg-s)) var(--dg-pad) !important;
    border: 0 !important;
    border-top: var(--dg-foot-rule) !important;
    border-radius: 0 !important;
    background: var(--dg-foot-bg) !important;
    """))
css.append(rule(within([WITHBODY, _W], f" > {FOOT}:not({HEAD} *)") + NL +
                within([_D], f" > :is({HEAD}, {TITLE}, {LEAD}, p) + {FOOT}"), "margin-top: 0 !important;"))
css.append(rule(within(_W, f" > {FOOT}:not({HEAD} *)"), "margin-top: auto !important;"))
css.append(comment("Grouped footers (secondary left, primary right) keep their groups on one line."))
css.append(rule(within(ANY, f" > {FOOT} > div:has(button)"), """
    display: flex !important;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(10px * var(--dg-s)) !important;
    margin: 0 !important;
    """))
css.append(rule(within(ANY, f" > {FOOT} > div:has(button):first-child:not(:only-child)"), "margin-right: auto !important;"))
css.append(rule(within(ANY, f" > {FOOT} > div:has(button):only-child"), "flex: 1 1 auto; justify-content: var(--dg-foot-justify) !important;"))
css.append(rule(within(ANY, BTN), """
    flex: var(--dg-btn-flex);
    min-height: var(--dg-btn-h) !important;
    height: auto !important;
    width: auto;
    margin: 0 !important;
    padding: 0 calc(20px * var(--dg-s)) !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: calc(8px * var(--dg-s)) !important;
    border-radius: var(--dg-btn-radius) !important;
    font-size: var(--dg-btn-size) !important;
    font-weight: 600 !important;
    line-height: 1.2 !important;
    letter-spacing: var(--dg-btn-track) !important;
    text-transform: var(--dg-btn-case) !important;
    white-space: nowrap;
    box-shadow: none !important;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease, translate .15s ease, filter .15s ease;
    """))
css.append(rule(within(ANY, SECONDARY_BTN), """
    border: 1px solid var(--dg-secondary-border) !important;
    background: var(--dg-secondary-bg) !important;
    color: var(--dg-secondary-ink) !important;
    """))
css.append(rule(within(ANY, SECONDARY_BTN + ":hover:not(:disabled)"), """
    border-color: color-mix(in srgb, var(--dg-accent) 40%, var(--dg-line)) !important;
    filter: brightness(.97);
    """))
css.append(rule(within(ANY, PRIMARY_BTN), """
    border: 1px solid transparent !important;
    background: var(--dg-primary-bg) !important;
    color: var(--dg-primary-ink) !important;
    """))
css.append(rule(within(ANY, PRIMARY_BTN + ":hover:not(:disabled)"), """
    background: var(--dg-primary-hover) !important;
    translate: 0 -1px;
    """))
css.append(rule(within(ANY, DANGER_BTN), """
    border: 1px solid var(--dg-danger) !important;
    background: var(--dg-danger) !important;
    color: #ffffff !important;
    """))
css.append(rule(within(ANY, DANGER_BTN + ":hover:not(:disabled)"), """
    background: color-mix(in srgb, var(--dg-danger) 86%, #000000) !important;
    border-color: color-mix(in srgb, var(--dg-danger) 86%, #000000) !important;
    """))
css.append(rule(within(ANY, BTN + "[class*=\"danger\"][class*=\"outline\"]"), """
    border: 1px solid color-mix(in srgb, var(--dg-danger) 40%, #ffffff) !important;
    background: #ffffff !important;
    color: var(--dg-danger) !important;
    """))
css.append(rule(within(ANY, BTN + "[class*=\"warn\"]:not([class*=\"outline\"])"), """
    border: 1px solid var(--dg-warn) !important;
    background: var(--dg-warn) !important;
    color: #ffffff !important;
    """))
css.append(rule(within(ANY, BTN + "[class*=\"warn\"][class*=\"outline\"]"), """
    border: 1px solid color-mix(in srgb, var(--dg-warn) 40%, #ffffff) !important;
    background: #ffffff !important;
    color: var(--dg-warn) !important;
    """))
css.append(rule(within(ANY, BTN + ":disabled"), """
    opacity: .5 !important;
    cursor: not-allowed !important;
    translate: none !important;
    """))
css.append(rule(within(ANY, BTN + " :is(svg, i)"), """
    width: calc(16px * var(--dg-s));
    height: calc(16px * var(--dg-s));
    font-size: calc(16px * var(--dg-s)) !important;
    margin: 0 !important;
    color: inherit !important;
    """))

# ---------------------------------------------------------------- 8. drawers
css.append(section("8. DRAWERS - a full-height sheet from the right. Open / closed mechanics (display, transform, "
                   "visibility) stay the screen's own; only surface and size are set here"))
css.append(rule(_W, """
    position: fixed !important;
    top: var(--dg-drawer-inset) !important;
    right: var(--dg-drawer-inset) !important;
    bottom: var(--dg-drawer-inset) !important;
    left: auto !important;
    width: var(--dg-drawer-w) !important;
    max-width: calc(100vw - 2 * var(--dg-drawer-inset)) !important;
    height: auto !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    border: var(--dg-border) !important;
    border-top: var(--dg-border-top) !important;
    border-radius: var(--dg-drawer-radius) !important;
    background: var(--dg-surface) !important;
    box-shadow: none !important;
    color: var(--dg-ink);
    overflow: hidden !important;
    """))
css.append(rule(G([w for w in W if w not in DRAWERS_SELF_ANIMATED]) + ":not(dialog:not([open]))", "animation: dg-slide .3s cubic-bezier(.2, .8, .2, 1) both;"))
css.append(rule(_W + NL + _D + NL + f"{PREFIX}.modal:has(> .modal-dialog)", "z-index: 1065 !important;"))
css.append(rule(f"{PREFIX}:is({', '.join(W)}):not(dialog:not([open])):not(:has(> {BODY}))", """
    overflow-y: auto !important;
    scrollbar-width: thin;
    """))
css.append(rule(f"{PREFIX}dialog.lq-drawer[open]", "inset: var(--dg-drawer-inset) var(--dg-drawer-inset) var(--dg-drawer-inset) auto !important;"))

# ---------------------------------------------------------------- 9. small screens
css.append(section("9. SMALL SCREENS AND REDUCED MOTION"))
css.append("@media (max-width: 575.98px) {\n")
css.append(textwrap.indent(rule(PREFIX.strip(), "--dg-pad: calc(20px * var(--dg-s)) !important;\n--dg-drawer-inset: 0px !important;"), "  "))
css.append(textwrap.indent(rule(_W, "border-radius: 0 !important;"), "  "))
css.append(textwrap.indent(rule(within(BOTH, DL_ROWS + " > div"), "grid-template-columns: minmax(0, 1fr) !important;"), "  "))
css.append(textwrap.indent(rule(within(ANY, BTN), "flex: 1 1 auto;"), "  "))
css.append("}\n")
css.append("@media (prefers-reduced-motion: reduce) {\n")
css.append(textwrap.indent(rule(G(D + W + SCRIMS), "animation: none !important;"), "  "))
css.append("}\n")

# ================================================================ 10. module designs
css.append(section("10. MODULE DESIGNS - one per module; none shares another's look"))


def mod_roots(mod):
    return roots(M(mod) + " ")


def module(mod, title, variables, extra=lambda r: ""):
    return "".join([f"\n/* ---- {title} ---- */\n", rule(M(mod), variables), extra(mod_roots(mod))])


# -- Administration: Folio --------------------------------------------------------------------------------
def admin_extra(r):
    return "".join([
        comment("A theme bar runs down the header's left edge (an inset shadow: it never shifts the layout)."),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD}| > {HEAD} + :is({LEAD}, p)") + NL + within([r["FLAT"]], FLAT_BAND),
             "box-shadow: inset calc(4px * var(--dg-s)) 0 0 var(--dg-accent) !important;"),
        rule(within([r["STRUCT"], r["W"], r["FLAT"]], f" {CLOSE}:is(button, a):hover"),
             "border-color: color-mix(in srgb, var(--dg-accent) 40%, var(--dg-line)) !important;\ncolor: var(--dg-accent) !important;"),
    ])


css.append(module("admin", "ADMINISTRATION - Folio: white sheet, a theme bar down the header's left edge, display-face title", """
    --dg-radius: calc(14px * var(--dg-s));
    --dg-border: 1px solid var(--dg-line);
    --dg-border-top: var(--dg-border);
    --dg-scrim: color-mix(in srgb, var(--dg-deep) 34%, transparent);
    --dg-blur: calc(4px * var(--dg-s));
    --dg-anim: dg-drop;
    --dg-band-rule: 1px solid var(--dg-line);
    --dg-title-size: calc(21px * var(--dg-s));
    --dg-close-radius: calc(10px * var(--dg-s));
    --dg-sheet-radius: calc(12px * var(--dg-s));
    --dg-field-radius: calc(10px * var(--dg-s));
    --dg-btn-h: calc(40px * var(--dg-s));
    --dg-btn-radius: calc(10px * var(--dg-s));
    --dg-drawer-radius: 0;
    --dg-drawer-w: min(calc(560px * var(--dg-s)), 100vw);
    """, admin_extra))


# -- Communications: Correspondence ------------------------------------------------------------------------
css.append(module("comms", "COMMUNICATIONS - Correspondence: warm paper, a theme rule across the top, serif title, pill buttons, floating drawers", """
    --dg-radius: calc(18px * var(--dg-s));
    --dg-surface: #fffdf8;
    --dg-border: 1px solid #ece4d3;
    --dg-border-top: calc(4px * var(--dg-s)) solid var(--dg-accent);
    --dg-scrim: color-mix(in srgb, #3b2f1c 30%, transparent);
    --dg-blur: calc(3px * var(--dg-s));
    --dg-anim: dg-rise;
    --dg-band-bg: transparent;
    --dg-band-rule: 1px dotted #d9ccb1;
    --dg-title-font: Georgia, 'Times New Roman', serif;
    --dg-title-size: calc(23px * var(--dg-s));
    --dg-title-weight: 600;
    --dg-title-track: 0;
    --dg-lead-style: italic;
    --dg-band-muted: #7a6d57;
    --dg-close-bg: transparent;
    --dg-close-border: 1px solid #e6dcc6;
    --dg-close-radius: 999px;
    --dg-sheet-bg: transparent;
    --dg-sheet-border: 1px solid #ece4d3;
    --dg-row-rule: 1px dotted #dccfb4;
    --dg-quiet-bg: #f8f3e8;
    --dg-field-bg: #fffefb;
    --dg-field-line: #e2d7c0;
    --dg-field-radius: calc(10px * var(--dg-s));
    --dg-foot-bg: transparent;
    --dg-foot-rule: 1px dashed #dccfb4;
    --dg-btn-radius: 999px;
    --dg-secondary-bg: transparent;
    --dg-secondary-border: #d9ccb1;
    --dg-drawer-inset: calc(14px * var(--dg-s));
    --dg-drawer-radius: calc(22px * var(--dg-s));
    """))


# -- Configuration: Blueprint ------------------------------------------------------------------------------
def config_extra(r):
    return "".join([
        comment("A faint outlined ring sits in the header's far corner (outline only, no fill)."),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD}"), "overflow: hidden;"),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD}::after"), """
            content: '';
            position: absolute;
            right: calc(-34px * var(--dg-s));
            bottom: calc(-58px * var(--dg-s));
            width: calc(140px * var(--dg-s));
            height: calc(140px * var(--dg-s));
            border: 1.5px solid color-mix(in srgb, var(--dg-accent) 16%, transparent);
            border-radius: 50%;
            pointer-events: none;
            """),
    ])


css.append(module("config", "CONFIGURATION - Blueprint: hairline frame, a full-width 2px theme rule under the header, faint corner ring", """
    --dg-radius: calc(10px * var(--dg-s));
    --dg-border: 1.5px solid color-mix(in srgb, var(--dg-accent) 22%, #e1e6e3);
    --dg-border-top: var(--dg-border);
    --dg-anim: dg-zoom;
    --dg-band-rule: 2px solid var(--dg-accent);
    --dg-title-font: var(--font-heading, inherit);
    --dg-title-size: calc(19px * var(--dg-s));
    --dg-title-track: .005em;
    --dg-close-radius: calc(8px * var(--dg-s));
    --dg-sheet-radius: calc(8px * var(--dg-s));
    --dg-field-radius: calc(8px * var(--dg-s));
    --dg-foot-rule: 1px solid color-mix(in srgb, var(--dg-accent) 18%, #e8ece9);
    --dg-btn-radius: calc(8px * var(--dg-s));
    --dg-drawer-radius: calc(10px * var(--dg-s)) 0 0 calc(10px * var(--dg-s));
    """, config_extra))


# -- Donations & Payments: Receipt -------------------------------------------------------------------------
def payments_extra(r):
    return "".join([
        comment("The header glyph sits in a thin dashed ring, centred (a pseudo-element: glyph tiles are stripped)."),
        rule(within([r["FLAT"]], f" > {GLYPH}:first-child:not(#dg-glyph)"), """
            position: relative;
            align-self: center !important;
            justify-content: center !important;
            align-items: center !important;
            width: calc(56px * var(--dg-s)) !important;
            height: calc(56px * var(--dg-s)) !important;
            margin: calc(24px * var(--dg-s)) auto 0 !important;
            padding: 0 !important;
            """),
        rule(within([r["FLAT"]], f" > {GLYPH}:first-child::before"), """
            content: '';
            position: absolute;
            inset: 0;
            border: 1.5px dashed color-mix(in srgb, currentColor 45%, transparent);
            border-radius: 50%;
            """),
        rule(within([r["FLAT"]], f" > {GLYPH}:first-child + {TITLE}:not(#dg-title)"), "padding-top: calc(12px * var(--dg-s)) !important;"),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD}"), "flex-direction: column;\njustify-content: center;"),
        comment("Figures (amounts, references) in the number face."),
        rule(within([r["D"], r["W"]], " dd"), "font-variant-numeric: tabular-nums;"),
        comment("Actions share the footer's full width."),
        rule(within([r["STRUCT"], r["W"], r["FLAT"]], f" > {FOOT} > div:has(button)"), "flex: 1 1 auto;"),
    ])


css.append(module("payments", "DONATIONS & PAYMENTS - Receipt: centred header, perforated divider, number-face figures, full-width paired buttons", """
    --dg-radius: calc(22px * var(--dg-s));
    --dg-border-top: var(--dg-border);
    --dg-anim: dg-rise;
    --dg-band-align: center;
    --dg-band-rule: 2px dashed color-mix(in srgb, var(--dg-accent) 22%, #d6dcd9);
    --dg-band-pt: calc(26px * var(--dg-s));
    --dg-band-pb: calc(20px * var(--dg-s));
    --dg-title-font: var(--font-heading, inherit);
    --dg-title-size: calc(20px * var(--dg-s));
    --dg-title-track: 0;
    --dg-close-radius: 999px;
    --dg-sheet-border: 1px dashed color-mix(in srgb, var(--dg-accent) 22%, #d6dcd9);
    --dg-row-rule: 1px dashed var(--dg-line-soft);
    --dg-value-font: var(--font-number, inherit);
    --dg-foot-rule: 0 solid transparent;
    --dg-foot-justify: stretch;
    --dg-btn-flex: 1 1 0;
    --dg-btn-h: calc(44px * var(--dg-s));
    --dg-btn-radius: calc(12px * var(--dg-s));
    --dg-drawer-radius: calc(22px * var(--dg-s)) 0 0 calc(22px * var(--dg-s));
    """, payments_extra))


# -- Donors & Leads: Aurora --------------------------------------------------------------------------------
def donors_extra(r):
    return "".join([
        comment("The header glyph sits in a thin solid theme ring (outline only)."),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD} > {GLYPH}:not(button):not({CLOSE})"), """
            border: 1.5px solid color-mix(in srgb, var(--dg-accent) 35%, #ffffff) !important;
            border-radius: 50% !important;
            width: calc(44px * var(--dg-s)) !important;
            height: calc(44px * var(--dg-s)) !important;
            font-size: calc(20px * var(--dg-s)) !important;
            """),
    ])


css.append(module("donors", "DONORS & LEADS - Aurora: generous 24px corners, glyph in a thin theme ring, pill buttons, floating drawers", """
    --dg-radius: calc(24px * var(--dg-s));
    --dg-border: 1px solid color-mix(in srgb, var(--dg-accent) 12%, #e8ecea);
    --dg-border-top: var(--dg-border);
    --dg-scrim: color-mix(in srgb, var(--dg-accent) 18%, rgba(20, 28, 25, .28));
    --dg-blur: calc(8px * var(--dg-s));
    --dg-anim: dg-zoom;
    --dg-band-rule: 1px solid var(--dg-line-soft);
    --dg-band-pt: calc(24px * var(--dg-s));
    --dg-title-size: calc(22px * var(--dg-s));
    --dg-close-radius: 999px;
    --dg-sheet-radius: calc(16px * var(--dg-s));
    --dg-field-radius: calc(14px * var(--dg-s));
    --dg-foot-rule: 1px solid var(--dg-line-soft);
    --dg-btn-radius: 999px;
    --dg-btn-h: calc(42px * var(--dg-s));
    --dg-secondary-border: color-mix(in srgb, var(--dg-accent) 30%, #dfe5e2);
    --dg-secondary-ink: var(--dg-accent);
    --dg-drawer-inset: calc(12px * var(--dg-s));
    --dg-drawer-radius: calc(24px * var(--dg-s));
    --dg-drawer-w: min(calc(520px * var(--dg-s)), 100vw);
    """, donors_extra))


# -- Finance: Ledger ---------------------------------------------------------------------------------------
def finance_extra(r):
    return "".join([
        comment("Ledger rows: a dotted leader runs from the label to the figure; figures right-aligned and tabular."),
        rule(within([r["D"], r["W"]], DL_ROWS + " > div"), "grid-template-columns: auto minmax(0, 1fr) !important;\nalign-items: end;"),
        rule(within([r["D"], r["W"]], DL_ROWS + " > div > dd"), """
            padding-left: calc(10px * var(--dg-s));
            text-align: right !important;
            font-variant-numeric: tabular-nums;
            background: radial-gradient(circle, color-mix(in srgb, var(--dg-muted) 45%, transparent) 1px, transparent 1.3px) left calc(100% - 4px) / 6px 6px repeat-x;
            """),
    ])


css.append(module("finance", "FINANCE - Ledger: crisp 8px corners, a double rule under the header, dotted ledger rows, small-caps buttons", """
    --dg-radius: calc(8px * var(--dg-s));
    --dg-border: 1px solid #d9dedb;
    --dg-border-top: var(--dg-border);
    --dg-scrim: rgba(24, 30, 28, .4);
    --dg-blur: 0px;
    --dg-anim: dg-drop;
    --dg-band-rule: calc(3px * var(--dg-s)) double #cfd5d2;
    --dg-title-font: var(--font-heading, inherit);
    --dg-title-size: calc(18px * var(--dg-s));
    --dg-title-track: .01em;
    --dg-close-radius: calc(4px * var(--dg-s));
    --dg-close-border: 1px solid #d9dedb;
    --dg-sheet-border: 0 solid transparent;
    --dg-sheet-radius: 0;
    --dg-row-rule: 1px solid #edf0ee;
    --dg-value-font: var(--font-number, inherit);
    --dg-field-radius: calc(4px * var(--dg-s));
    --dg-field-line: #cfd5d2;
    --dg-foot-rule: calc(3px * var(--dg-s)) double #cfd5d2;
    --dg-btn-h: calc(38px * var(--dg-s));
    --dg-btn-radius: calc(4px * var(--dg-s));
    --dg-btn-size: calc(12.5px * var(--dg-s));
    --dg-btn-case: uppercase;
    --dg-btn-track: .07em;
    --dg-drawer-radius: 0;
    """, finance_extra))


# -- Inventory: Spec sheet ---------------------------------------------------------------------------------
def inventory_extra(r):
    return "".join([
        comment("Bootstrap fact tiles become a bordered spec grid: square white cells sharing hairlines."),
        rule(within([r["D"]], " .modal-body > .row:has(> [class*=\"col\"] > .bg-light)"), """
            --bs-gutter-x: 0 !important;
            --bs-gutter-y: 0 !important;
            margin: 0 !important;
            border: 1px solid #d5dad7;
            border-radius: calc(4px * var(--dg-s));
            overflow: hidden;
            """),
        rule(within([r["D"]], " .modal-body > .row > [class*=\"col\"] > .bg-light"), """
            height: 100%;
            border: 0 !important;
            border-radius: 0 !important;
            border-bottom: 1px solid #e3e7e5 !important;
            background: #ffffff !important;
            padding: calc(12px * var(--dg-s)) calc(14px * var(--dg-s)) !important;
            """),
        rule(within([r["D"]], " .modal-body > .row > [class*=\"col\"]:nth-child(odd) > .bg-light"), "border-right: 1px solid #e3e7e5 !important;"),
        rule(within([r["D"]], " .modal-body > .row > [class*=\"col\"] > .bg-light small"), """
            font-size: calc(10.5px * var(--dg-s)) !important;
            letter-spacing: .08em;
            text-transform: uppercase;
            """),
    ])


css.append(module("inventory", "INVENTORY - Spec sheet: square corners, stamped uppercase title over a 2px ink rule, bordered spec grid, light unblurred scrim", """
    --dg-radius: calc(4px * var(--dg-s));
    --dg-border: 1px solid #cdd3d0;
    --dg-border-top: var(--dg-border);
    --dg-scrim: rgba(30, 36, 34, .24);
    --dg-blur: 0px;
    --dg-anim: dg-pop;
    --dg-band-rule: 2px solid var(--dg-ink);
    --dg-band-pt: calc(20px * var(--dg-s));
    --dg-band-pb: calc(14px * var(--dg-s));
    --dg-title-font: var(--font-number, var(--font-heading, inherit));
    --dg-title-size: calc(16px * var(--dg-s));
    --dg-title-case: uppercase;
    --dg-title-track: .06em;
    --dg-glyph: var(--dg-ink);
    --dg-close-radius: calc(4px * var(--dg-s));
    --dg-close-border: 1px solid #cdd3d0;
    --dg-sheet-border: 1px solid #d5dad7;
    --dg-sheet-radius: calc(4px * var(--dg-s));
    --dg-field-radius: calc(4px * var(--dg-s));
    --dg-foot-rule: 1px solid #cdd3d0;
    --dg-btn-h: calc(38px * var(--dg-s));
    --dg-btn-radius: calc(4px * var(--dg-s));
    --dg-btn-track: .02em;
    --dg-drawer-radius: 0;
    """, inventory_extra))


# -- Masters: Medallion ------------------------------------------------------------------------------------
def masters_extra(r):
    return "".join([
        comment("The glyph sits in an outlined circular medallion (a pseudo-element: glyph tiles are stripped)."),
        rule(within([r["FLAT"]], f" > {GLYPH}:first-child:not(#dg-glyph)"), """
            position: relative;
            isolation: isolate;
            align-self: center !important;
            justify-content: center !important;
            align-items: center !important;
            width: calc(60px * var(--dg-s)) !important;
            height: calc(60px * var(--dg-s)) !important;
            margin: calc(26px * var(--dg-s)) auto calc(4px * var(--dg-s)) !important;
            padding: 0 !important;
            background: transparent !important;
            """),
        rule(within([r["FLAT"]], f" > {GLYPH}:first-child::before"), """
            content: '';
            position: absolute;
            inset: 0;
            z-index: -1;
            border-radius: 50%;
            border: 1.5px solid color-mix(in srgb, currentColor 40%, #ffffff);
            outline: 1px solid color-mix(in srgb, currentColor 14%, #ffffff);
            outline-offset: calc(5px * var(--dg-s));
            """),
        rule(within([r["FLAT"]], f" > {GLYPH}:first-child + {TITLE}:not(#dg-title)"), "padding-top: calc(16px * var(--dg-s)) !important;"),
        comment("Notes under the header are centred too."),
        rule(within([r["FLAT"]], f" > :not({FOOT}):not({GLYPH}):not({TITLE})"), "text-align: center !important;"),
    ])


css.append(module("masters", "MASTERS - Medallion: centred round an outlined circular glyph medallion, equal-width buttons", """
    --dg-radius: calc(20px * var(--dg-s));
    --dg-border-top: var(--dg-border);
    --dg-anim: dg-zoom;
    --dg-band-align: center;
    --dg-band-rule: 0 solid transparent;
    --dg-band-pt: calc(26px * var(--dg-s));
    --dg-band-pb: calc(4px * var(--dg-s));
    --dg-gap: calc(16px * var(--dg-s));
    --dg-title-size: calc(22px * var(--dg-s));
    --dg-foot-rule: 0 solid transparent;
    --dg-foot-justify: stretch;
    --dg-btn-flex: 1 1 0;
    --dg-btn-radius: calc(12px * var(--dg-s));
    --dg-btn-h: calc(44px * var(--dg-s));
    """, masters_extra))


# -- Organisation: Charter ---------------------------------------------------------------------------------
def organisation_extra(r):
    return "".join([
        comment("A small gold diamond sits on the centre of the gold hairline under the header."),
        # Pseudo-elements cannot sit inside :is(), so each band ending gets its own selector list entry.
        rule(NL.join([within([r["STRUCT"], r["W"]], f" > {HEAD}:not(:has(+ :is({LEAD}, p)))::after"),
                      within([r["STRUCT"], r["W"]], f" > {HEAD} + :is({LEAD}, p)::after")]
                     + [within([r["FLAT"]], part + "::after") for part in FLAT_BAND_LAST.split("|")]), """
            content: '';
            position: absolute;
            left: 50%;
            bottom: calc(-5px * var(--dg-s));
            width: calc(9px * var(--dg-s));
            height: calc(9px * var(--dg-s));
            translate: -50% 0;
            rotate: 45deg;
            border: 1px solid #b58a3a;
            background: #ffffff;
            pointer-events: none;
            """),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD} + :is({LEAD}, p)") + NL + within([r["FLAT"]], FLAT_BAND_LAST),
             "position: relative;"),
    ])


css.append(module("organisation", "ORGANISATION - Charter: gold hairline under the header with a centred diamond, display-face title, gold eyebrow", """
    --dg-radius: calc(16px * var(--dg-s));
    --dg-border-top: var(--dg-border);
    --dg-anim: dg-rise;
    --dg-band-rule: 1px solid color-mix(in srgb, #b58a3a 60%, #ffffff);
    --dg-band-pb: calc(20px * var(--dg-s));
    --dg-eyebrow: #9a7430;
    --dg-glyph: #9a7430;
    --dg-title-size: calc(22px * var(--dg-s));
    --dg-close-radius: 50%;
    --dg-sheet-radius: calc(12px * var(--dg-s));
    --dg-row-rule: 1px solid color-mix(in srgb, #b58a3a 14%, #eef0ef);
    --dg-foot-rule: 1px solid var(--dg-line-soft);
    --dg-btn-radius: calc(10px * var(--dg-s));
    --dg-drawer-radius: calc(16px * var(--dg-s)) 0 0 calc(16px * var(--dg-s));
    """, organisation_extra))


# -- Platform: Frame ---------------------------------------------------------------------------------------
def platform_extra(r):
    return "".join([
        comment("A short accent bar under the title (horizontal, drawn by the title itself)."),
        rule(within([r["STRUCT"], r["W"]], f" > {HEAD} {TITLE}::after") + NL + within([r["FLAT"]], f" > {TITLE}:first-child::after"), """
            content: '';
            display: block;
            width: calc(36px * var(--dg-s));
            height: calc(3px * var(--dg-s));
            margin-top: calc(10px * var(--dg-s));
            border-radius: 99px;
            background: var(--dg-accent);
            """),
    ])


css.append(module("platform", "PLATFORM - Frame: white sheet in a 2px theme frame, a short accent under the title", """
    --dg-radius: calc(12px * var(--dg-s));
    --dg-border: 2px solid var(--dg-accent);
    --dg-border-top: var(--dg-border);
    --dg-anim: dg-pop;
    --dg-band-rule: 1px solid var(--dg-line-soft);
    --dg-title-font: var(--font-heading, inherit);
    --dg-title-size: calc(20px * var(--dg-s));
    --dg-title-track: 0;
    --dg-close-radius: 50%;
    --dg-sheet-radius: calc(10px * var(--dg-s));
    --dg-foot-rule: 1px solid var(--dg-line-soft);
    --dg-btn-radius: calc(10px * var(--dg-s));
    --dg-secondary-border: var(--dg-accent);
    --dg-secondary-ink: var(--dg-accent);
    --dg-drawer-radius: 0;
    """, platform_extra))


# -- Workspace: Glass --------------------------------------------------------------------------------------
def workspace_extra(r):
    return "".join([
        comment("Frosted sheet with a gradient hairline across its top edge."),
        rule(r["D"] + NL + r["W"], """
            -webkit-backdrop-filter: blur(calc(18px * var(--dg-s))) saturate(150%);
            backdrop-filter: blur(calc(18px * var(--dg-s))) saturate(150%);
            background-image: linear-gradient(90deg, var(--dg-accent), #c1a466 55%, var(--dg-accent)) !important;
            background-size: 100% calc(3px * var(--dg-s)) !important;
            background-repeat: no-repeat !important;
            """),
    ])


css.append(module("workspace", "WORKSPACE - Glass: frosted translucent sheet, a gradient hairline across the top, compact controls", """
    --dg-radius: calc(18px * var(--dg-s));
    --dg-surface: color-mix(in srgb, #ffffff 90%, transparent);
    --dg-border: 1px solid color-mix(in srgb, #ffffff 60%, var(--dg-line));
    --dg-border-top: var(--dg-border);
    --dg-scrim: rgba(235, 238, 237, .38);
    --dg-blur: calc(14px * var(--dg-s));
    --dg-anim: dg-drop;
    --dg-band-bg: transparent;
    --dg-band-rule: 1px solid color-mix(in srgb, var(--dg-line) 70%, transparent);
    --dg-band-pb: calc(16px * var(--dg-s));
    --dg-title-font: var(--font-heading, inherit);
    --dg-title-size: calc(18px * var(--dg-s));
    --dg-title-track: 0;
    --dg-close-bg: transparent;
    --dg-close-border: 1px solid transparent;
    --dg-close-radius: calc(9px * var(--dg-s));
    --dg-sheet-bg: transparent;
    --dg-sheet-radius: calc(12px * var(--dg-s));
    --dg-quiet-bg: color-mix(in srgb, #ffffff 60%, transparent);
    --dg-field-bg: color-mix(in srgb, #ffffff 85%, transparent);
    --dg-field-radius: calc(10px * var(--dg-s));
    --dg-foot-bg: transparent;
    --dg-foot-rule: 1px solid color-mix(in srgb, var(--dg-line) 70%, transparent);
    --dg-btn-h: calc(38px * var(--dg-s));
    --dg-btn-radius: calc(10px * var(--dg-s));
    --dg-btn-size: calc(13.5px * var(--dg-s));
    --dg-secondary-bg: color-mix(in srgb, #ffffff 70%, transparent);
    --dg-drawer-radius: calc(18px * var(--dg-s)) 0 0 calc(18px * var(--dg-s));
    """, workspace_extra))

OUT.write_text("".join(css), encoding="utf-8")
print(OUT, len("".join(css)))
