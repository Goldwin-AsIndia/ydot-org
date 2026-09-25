# Run: python tools/generate-dialog-styles.py   (from UI/YDots.UI)
# Generates src/styles/ydot-dialogs.css - the pop-up (dialog) and off-canvas (drawer) design for every module
# outside Campaigns. Every module shares ONE design: the Campaigns > Tracking asset manager pop-up (whose own
# chrome lives in styles/ydot-overlays.css). The registries below name each screen's scrim, dialog and drawer
# classes and which module every screen belongs to.
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


# ------------------------------------------------------------------------------------------------ registries
SCRIMS = [
    ".ar-backdrop", ".modal-overlay", ".mc-modal-backdrop", ".oc-overlay",
    ".msec-modal-backdrop", ".msec-backdrop", ".rx-overlay", ".modal-backdrop", ".dir-overlay",
    ".up-backdrop", ".sec-modal-overlay", "app-communication-exception-queue .scrim",
    "app-sla-policy-calendar .overlay", "app-outbound-message-composer .overlay", ".panel-backdrop",
    ".drawer-overlay", ".drawer-backdrop", ".pr-modal-backdrop", ".pr-detail-backdrop", ".dialog-backdrop",
    ".ab-drawer-backdrop", ".ab-modal-backdrop", ".ct-overlay",
    ".dl-drawer-backdrop", ".fq-scrim", ".offcanvas-backdrop", ".ode-modal-backdrop",
    ".pci-modal-backdrop", ".rwn-offcanvas-backdrop", ".rwn-modal-backdrop", ".sb-modal-backdrop",
    ".gm-overlay", ".gs-modal-backdrop", ".nc-modal-scrim", ".sh-modal-backdrop",
    ".svb-modal-backdrop", ".slp-modal-backdrop", ".srd-modal-backdrop", ".dl-modal-backdrop",
    ".org-modal-backdrop", ".df-backdrop", ".dq-scrim", "app-menu-configuration .mcs-scrim",
]
# Scrims that fade themselves in and out with opacity / visibility (checkbox-driven): colour only.
SCRIMS_COLOUR_ONLY = [".filter-modal-backdrop"]

DIALOGS = [
    ".ar-modal", ".bu-modal", ".modal-modern", ".mc-modal", ".msec-modal:not(.modal)",
    ".rx-modal", ".modal-content", ".dir-dialog", ".up-modal", ".sec-modal",
    ".modal:not(.d-block):not(.fade):not(.modal-split):not(:has(> .modal-dialog))",
    "app-payment-gateway-configuration .modal-dialog", ".pr-modal",
    "app-public-donation-initiation .dialog", ".ab-modal", ".ct-modal", "dialog.action-dialog > form",
    ".dq-dialog", "dialog.xr-dialog", "dialog.fp-dialog",
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
              "app-duplicate-review .modal", "dialog.action-dialog > form", ".modal-modern"]

DRAWERS = [
    ".dir-sheet", "app-menu-configuration .oc", "app-role-catalogue .rx-oc", "app-communication-exception-queue .drawer",
    "app-sla-policy-calendar .drawer", "app-template-catalogue .drawer",
    "app-suppression-and-contact-restriction .side-panel", "app-payment-gateway-configuration .details-pane",
    ".pr-detail", ".ab-drawer", ".ct-drawer", ".dl-drawer",
    ".fq-drawer", "dialog.lq-drawer", ".lead-offcanvas", ".rwn-offcanvas", "app-menu-configuration .mcs",
    "dialog.pq-drawer",
]
# Drawers that slide in and out with their own transform: no entry animation from this layer.
# (Communication Timeline's Log communication slip used to be here; it now has its own design, `.lg`.)
DRAWERS_SELF_ANIMATED = []

HEAD = (':is(header, [class*="-head"]:not([class*="-heading"]), [class*="__head"], [class*="-header"], [class*="__header"], '
        '[class*="-modal-top"], [class*="-dialog-top"], [class*="__top"], .pn-top, .modal-header, .dir-sheet-hero)')
BODY = ':is([class*="-body"], [class*="__body"], .modal-body)'
FOOT = (':is(footer, [class*="-foot"], [class*="__foot"], [class*="-footer"], [class*="__footer"], '
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
   YDot Dialogs - pop-ups (dialogs) and off-canvas panels (drawers) for every module outside Campaigns, all in
   the Campaigns > Tracking asset manager design.

   GENERATED - do not edit by hand. Source: tools/generate-dialog-styles.py (run it from UI/YDots.UI).

   ONE DESIGN FOR EVERY MODULE (2026-09-25): the Campaigns > Tracking asset manager pop-up. Campaigns get it from
   styles/ydot-overlays.css; every other module gets the same look from this file:
     - a tinted HEADER BAND with a soft theme glow, a 42px gradient ICON TILE (the header's own glyph, or a
       document-check glyph drawn in CSS; a red warning tile on destructive dialogs), an uppercase theme kicker,
       a display-face title and a compact muted lead;
     - a quiet 34px close square in the band's corner;
     - a white BODY that alone scrolls, with a slim rounded scrollbar;
     - record facts as a tinted SUMMARY SHEET (label left, value right, hairline rows);
     - 12px-radius FIELDS with a theme focus ring;
     - a tinted, pinned ACTION FOOTER: 40px buttons, primary in the theme colour, destructive in a red gradient;
     - 22px corners, a blurred theme scrim; drawers are full-height sheets from the right with the same band.
   New pop-ups should use the shared <app-popup> component (src/app/Shared/components/popup), which renders
   this design directly.

   HOW. A shared base (sections 1-9) lays out every dialog and drawer by ROLE - head, body, footer, title, lead,
   facts, fields, buttons - and reads every visual decision from --dg-* custom properties. Section 10 sets those
   properties once for every registered host and adds the icon tile, band glow and footer details.

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
                f"{PREFIX}dialog:is(.action-dialog, .execution-modal, .fup-confirm-dialog, .lq-drawer, .xr-dialog, .fp-dialog, .pq-drawer)::backdrop", """
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

css.append(comment("A native <dialog> whose parts sit inside a <form> (Donor 360): the form is the sheet, the dialog only "
                   "holds it."))
css.append(rule(f"{PREFIX}dialog.action-dialog[open]", """
    width: auto !important;
    max-width: none !important;
    max-height: none !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    overflow: visible !important;
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
css.append(rule(f"{PREFIX}dialog:is(.lq-drawer, .pq-drawer)[open]", "inset: var(--dg-drawer-inset) var(--dg-drawer-inset) var(--dg-drawer-inset) auto !important;"))

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

# ================================================================ 10. the shared design
css.append(section("10. ONE SHARED DESIGN - the Campaigns > Tracking asset manager pop-up, for every module"))

S = PREFIX.strip()
css.append(rule(S, """
    --dg-pad: calc(28px * var(--dg-s));
    --dg-radius: calc(22px * var(--dg-s));
    --dg-border: 1px solid var(--dg-line);
    --dg-border-top: var(--dg-border);
    --dg-scrim: color-mix(in srgb, var(--dg-deep) 52%, transparent);
    --dg-blur: calc(6px * var(--dg-s));
    --dg-anim: dg-pop;
    --dg-band: color-mix(in srgb, var(--theme-surface-tint, #eef1ef) 55%, #ffffff);
    --dg-band-bg: var(--dg-band);
    --dg-band-rule: 1px solid var(--dg-line);
    --dg-band-pt: calc(18px * var(--dg-s));
    --dg-band-pb: calc(16px * var(--dg-s));
    --dg-glyph: var(--dg-accent);
    --dg-eyebrow: var(--dg-accent);
    --dg-title-font: var(--font-display, inherit);
    --dg-title-size: calc(var(--fs-base, calc(14px * var(--dg-s))) * 1.357);
    --dg-title-weight: 700;
    --dg-title-case: none;
    --dg-title-track: -0.01em;
    --dg-lead-style: normal;
    --dg-close-bg: transparent;
    --dg-close-border: 1px solid transparent;
    --dg-close-ink: var(--dg-muted);
    --dg-close-radius: calc(10px * var(--dg-s));
    --dg-body-bg: #ffffff;
    --dg-gap: calc(20px * var(--dg-s));
    --dg-sheet-bg: color-mix(in srgb, var(--theme-surface-tint, #eef1ef) 22%, #ffffff);
    --dg-sheet-border: 1px solid var(--dg-line);
    --dg-sheet-radius: calc(14px * var(--dg-s));
    --dg-row-rule: 1px solid var(--dg-line-soft);
    --dg-field-radius: calc(12px * var(--dg-s));
    --dg-field-line: color-mix(in srgb, var(--dg-accent) 18%, #dde2df);
    --dg-foot-bg: color-mix(in srgb, var(--theme-surface-tint, #eef1ef) 30%, #ffffff);
    --dg-foot-rule: 1px solid var(--dg-line);
    --dg-foot-justify: flex-end;
    --dg-btn-h: calc(40px * var(--dg-s));
    --dg-btn-radius: calc(11px * var(--dg-s));
    --dg-btn-size: calc(var(--fs-base, calc(14px * var(--dg-s))) * 0.964);
    --dg-btn-case: none;
    --dg-btn-track: 0;
    --dg-btn-flex: 0 1 auto;
    --dg-secondary-bg: #ffffff;
    --dg-secondary-border: var(--dg-line);
    --dg-secondary-ink: var(--dg-ink);
    --dg-drawer-w: min(calc(560px * var(--dg-s)), 100vw);
    --dg-drawer-inset: 0px;
    --dg-drawer-radius: var(--dg-radius) 0 0 var(--dg-radius);
    --dg-tile: calc(42px * var(--dg-s));
    --dg-tile-fill: linear-gradient(145deg, var(--dg-accent), color-mix(in srgb, var(--dg-accent) 68%, #000000));
    --dg-tile-danger: linear-gradient(145deg, var(--dg-danger), color-mix(in srgb, var(--dg-danger) 70%, #000000));
    """))

# A header's glyph: an icon class, a bare <i>/<svg>, or a glyph / ring wrapper. No :has() in here: it is used inside
# :has(), and CSS does not allow :has() to nest (the whole selector list would be dropped).
HG = (f":is({GLYPH}, i, svg, [class*=\"glyph\"], [class*=\"-ring\"], [class*=\"-seal\"], [class*=\"-medallion\"])"
      f":not(button):not({CLOSE}):not([class*=\"title\"]):not([class*=\"text\"])")
HG_DIRECT = f" > {HEAD} > {HG}:first-child"
HG_NESTED = f" > {HEAD} > :first-child:not({CLOSE}):not({HG}) > {HG}:first-child"
TILE_PSEUDO = (f" > {HEAD}:not(:has(> {HG}:first-child))"
               f":not(:has(> :first-child:not({CLOSE}):not({HG}) > {HG}:first-child))")
TILE_GLYPH = f" > {HEAD}:has(> {HG}:first-child)"
DANGER_D = ':is([class*="danger"], [class*="destructive"])'
DANGER_HEAD = f':has(:is([class*="title-danger"], [class*="-danger"]):not(button):not({CLOSE}))'
DOC_ICON = ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' "
            "stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 "
            "2 0 0 0 2-2V8z'/%3E%3Cpath d='M14 3v5h5M9 14l2 2 4-4'/%3E%3C/svg%3E\")")
WARN_ICON = ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' "
             "stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 "
             "0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'/%3E%3Cpath d='M12 9v4M12 17h.01'/%3E%3C/svg%3E\")")

css.append(comment("Header band: a soft theme glow in the top-left corner over the tint (dialogs and drawers)."))
css.append(rule(within(HEADS, f" > {HEAD}"), """
    background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--dg-accent) 9%, transparent) 0%, transparent 60%), var(--dg-band) !important;
    """))
css.append(comment("Dialog headers are a two-column grid: the icon tile, then kicker / title / lead stacked beside it."))
css.append(rule(within(STRUCT, f" > {HEAD}"), """
    display: grid !important;
    grid-template-columns: minmax(0, 1fr);
    column-gap: calc(14px * var(--dg-s)) !important;
    row-gap: 0 !important;
    align-items: center !important;
    """))
css.append(rule(within(STRUCT, TILE_PSEUDO) + NL + within(STRUCT, TILE_GLYPH), "grid-template-columns: var(--dg-tile) minmax(0, 1fr);"))
css.append(rule(within(STRUCT, TILE_PSEUDO + f" > :not({CLOSE})") + NL + within(STRUCT, TILE_GLYPH + f" > :not({CLOSE}):not(:first-child)"),
                "grid-column: 2;\nmin-width: 0;"))
css.append(comment("A header without its own icon gets the tile drawn in CSS: a document-check glyph, or a warning "
                   "triangle on a red tile for destructive dialogs. An icon set inline in front of the title gives way to it."))
css.append(rule(within(STRUCT, TILE_PSEUDO + "::before"), f"""
    content: '';
    grid-column: 1;
    grid-row: 1 / span 6;
    align-self: start;
    width: var(--dg-tile);
    height: var(--dg-tile);
    border-radius: calc(12px * var(--dg-s));
    background: {DOC_ICON} center / calc(22px * var(--dg-s)) calc(22px * var(--dg-s)) no-repeat, var(--dg-tile-fill);
    """))
css.append(rule(NL.join([f"{STRUCT}{DANGER_D}{TILE_PSEUDO}::before", within(STRUCT, TILE_PSEUDO + DANGER_HEAD + "::before")]),
                f"background: {WARN_ICON} center / calc(22px * var(--dg-s)) calc(22px * var(--dg-s)) no-repeat, var(--dg-tile-danger);"))
css.append(rule(within(STRUCT, TILE_PSEUDO + f" {TITLE} > :is(i, svg):first-child"), "display: none !important;"))
css.append(comment("A header's own glyph (first in the header, or first in its leading wrapper) becomes the tile: white "
                   "glyph on the theme gradient (red for danger / error, amber for warnings)."))
TILE_EL = within(STRUCT, HG_DIRECT) + NL + within(STRUCT, HG_NESTED)
css.append(rule(within(STRUCT, HG_DIRECT), """
    grid-column: 1;
    grid-row: 1 / span 6;
    align-self: start;
    """))
css.append(rule(TILE_EL, """
    flex: none;
    display: inline-grid !important;
    place-items: center !important;
    width: var(--dg-tile) !important;
    min-width: var(--dg-tile) !important;
    height: var(--dg-tile) !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: calc(12px * var(--dg-s)) !important;
    background: var(--dg-tile-fill) !important;
    box-shadow: none !important;
    color: #ffffff !important;
    font-size: calc(21px * var(--dg-s)) !important;
    line-height: 1 !important;
    """))
css.append(rule(within(STRUCT, f" > {HEAD} > {TITLE}:has(> {HG}:first-child)"), """
    display: flex !important;
    align-items: center !important;
    gap: calc(14px * var(--dg-s)) !important;
    """))
css.append(rule(within(STRUCT, HG_DIRECT + " :is(svg, i)") + NL + within(STRUCT, HG_NESTED + " :is(svg, i)"), """
    width: calc(22px * var(--dg-s)) !important;
    height: calc(22px * var(--dg-s)) !important;
    font-size: calc(21px * var(--dg-s)) !important;
    color: #ffffff !important;
    """))
css.append(rule(within(STRUCT, HG_DIRECT + ":is([class*=\"danger\"], [class*=\"error\"])") + NL
                + within(STRUCT, HG_NESTED + ":is([class*=\"danger\"], [class*=\"error\"])") + NL
                + f"{STRUCT}{DANGER_D}{HG_DIRECT}" + NL + f"{STRUCT}{DANGER_D}{HG_NESTED}",
                "background: var(--dg-tile-danger) !important;\ncolor: #ffffff !important;"))
css.append(rule(within(STRUCT, HG_DIRECT + ":is([class*=\"warn\"])") + NL + within(STRUCT, HG_NESTED + ":is([class*=\"warn\"])"),
                "background: linear-gradient(145deg, var(--dg-warn), color-mix(in srgb, var(--dg-warn) 70%, #000000)) !important;"))
css.append(rule(within(STRUCT, HG_DIRECT + ":is([class*=\"success\"])") + NL + within(STRUCT, HG_NESTED + ":is([class*=\"success\"])"),
                "background: linear-gradient(145deg, #2f7d4f, color-mix(in srgb, #2f7d4f 70%, #000000)) !important;"))

css.append(comment("Dialogs without a head wrapper (title and lead sit loose in the dialog): the same tile, drawn by the "
                   "dialog itself (or the dialog's own leading glyph, lifted out of the flow) in the band's top-left "
                   "corner; the band parts step in to clear it."))
FLAT_G = f" > {GLYPH}:first-child:not(button):not({CLOSE}):not(#dg-g)"
FLAT_NOG = f"{FLAT}:not(:has({FLAT_G}))"
css.append(rule(f":where({FLAT})", "position: relative;"))
css.append(rule(within(FLAT, FLAT_BAND), "padding-left: calc(var(--dg-pad) + var(--dg-tile) + calc(14px * var(--dg-s))) !important;"))
css.append(rule(within(FLAT, f" > {GLYPH}:first-child + {TITLE}:not(#dg-t)"), "padding-top: var(--dg-band-pt) !important;"))
css.append(rule(within(FLAT, f"{FLAT_G}| > {CLOSE}:first-child + {GLYPH}:not(button):not(#dg-g)"), """
    position: absolute !important;
    top: var(--dg-band-pt) !important;
    left: var(--dg-pad) !important;
    z-index: 2;
    display: grid !important;
    place-items: center !important;
    width: var(--dg-tile) !important;
    height: var(--dg-tile) !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: calc(12px * var(--dg-s)) !important;
    background: var(--dg-tile-fill) !important;
    color: #ffffff !important;
    font-size: calc(21px * var(--dg-s)) !important;
    """))
css.append(rule(within(FLAT, f"{FLAT_G} svg| > {CLOSE}:first-child + {GLYPH}:not(button):not(#dg-g) svg"), """
    width: calc(22px * var(--dg-s)) !important;
    height: calc(22px * var(--dg-s)) !important;
    color: #ffffff !important;
    """))
css.append(rule(NL.join([within(FLAT, f"{FLAT_G}:is([class*=\"danger\"], [class*=\"error\"])"), f"{FLAT}{DANGER_D}{FLAT_G}"]),
                "background: var(--dg-tile-danger) !important;"))
css.append(rule(f"{FLAT_NOG}::before", f"""
    content: '';
    position: absolute;
    top: var(--dg-band-pt);
    left: var(--dg-pad);
    z-index: 2;
    width: var(--dg-tile);
    height: var(--dg-tile);
    border-radius: calc(12px * var(--dg-s));
    background: {DOC_ICON} center / calc(22px * var(--dg-s)) calc(22px * var(--dg-s)) no-repeat, var(--dg-tile-fill);
    pointer-events: none;
    """))
css.append(rule(NL.join([f"{FLAT_NOG}{DANGER_D}::before", f"{FLAT_NOG}:has(> {TITLE}[class*=\"danger\"])::before"]),
                f"background: {WARN_ICON} center / calc(22px * var(--dg-s)) calc(22px * var(--dg-s)) no-repeat, var(--dg-tile-danger);"))
css.append(rule(NL.join([f"{FLAT}{DANGER_D} > {TITLE}:first-child", f"{FLAT}{DANGER_D} > :is({GLYPH}, {CLOSE}):first-child + {TITLE}"]),
                "color: var(--dg-danger) !important;"))

css.append(comment("Header type: uppercase theme kicker, display-face title, compact muted lead."))
css.append(rule(within(HEADS, f" > {HEAD} :is([class*=\"eyebrow\"], [class*=\"kicker\"], [class*=\"-step\"])"), """
    margin: 0 0 2px !important;
    font-size: calc(var(--fs-base, calc(14px * var(--dg-s))) * 0.786) !important;
    """))
css.append(rule(NL.join([f"{STRUCT}{DANGER_D} > {HEAD} :is([class*=\"eyebrow\"], [class*=\"kicker\"])",
                         f"{STRUCT}{DANGER_D} > {HEAD} {TITLE}"]), "color: var(--dg-danger) !important;"))
css.append(rule(within(HEADS, f" > {HEAD} :is({LEAD}, {TITLE} + p)"), """
    margin: calc(3px * var(--dg-s)) 0 0 !important;
    font-size: calc(var(--fs-base, calc(14px * var(--dg-s))) * 0.893) !important;
    line-height: 1.45 !important;
    """))
css.append(comment("Close button: a quiet square in the band's top-right corner; white with a hairline on hover."))
css.append(rule(CLOSE_SEL, """
    width: calc(34px * var(--dg-s)) !important;
    height: calc(34px * var(--dg-s)) !important;
    """))
css.append(rule(within(ANY, f" {CLOSE}:is(button, a):hover"), """
    rotate: none;
    background-color: #ffffff !important;
    border-color: var(--dg-line) !important;
    color: var(--dg-ink) !important;
    """))

css.append(comment("A confirmation that is only a header and buttons: the band runs straight into the footer."))
css.append(rule(within(ANY, f" > :is({HEAD}, {TITLE}, {LEAD}, p):has(+ {FOOT}):not(#dg-c)"), "margin-bottom: 0 !important;"))
css.append(rule(within(ANY, f" > :is({HEAD}, {TITLE}, {LEAD}, p) + {FOOT}:not(#dg-c)"), "margin-top: 0 !important;\nborder-top: 0 !important;"))

css.append(comment("Body: white, with a slim rounded scrollbar inset from the edge."))
css.append(rule(within(WITHBODY, f" > {BODY}"), """
    scrollbar-gutter: stable;
    scrollbar-color: color-mix(in srgb, var(--dg-accent) 38%, #c9d1cd) transparent;
    """))
css.append(rule(NL.join(f"{r} > {BODY}::-webkit-scrollbar" for r in [WITHBODY]), "width: calc(12px * var(--dg-s));"))
css.append(rule(NL.join(f"{r} > {BODY}::-webkit-scrollbar-thumb" for r in [WITHBODY]), """
    border: calc(3px * var(--dg-s)) solid transparent;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dg-accent) 38%, #c9d1cd);
    background-clip: padding-box;
    """))

css.append(comment("Footer: tinted, pinned, compact; the destructive action wears the danger tile's red gradient."))
css.append(rule(within(ANY, f" > {FOOT}:not({HEAD} *)"), "padding: calc(12px * var(--dg-s)) var(--dg-pad) !important;"))
css.append(rule(within(ANY, BTN), "padding: 0 calc(18px * var(--dg-s)) !important;"))
css.append(rule(within(ANY, DANGER_BTN), """
    border: 1px solid color-mix(in srgb, var(--dg-danger) 70%, #000000) !important;
    background: var(--dg-tile-danger) !important;
    """))
css.append(rule(within(ANY, DANGER_BTN + ":hover:not(:disabled)"),
                "background: linear-gradient(145deg, color-mix(in srgb, var(--dg-danger) 88%, #000000), color-mix(in srgb, var(--dg-danger) 60%, #000000)) !important;"))

css.append("@media (max-width: 575.98px) {\n")
css.append(textwrap.indent(rule(within(STRUCT, f" > {HEAD}"), "grid-template-columns: minmax(0, 1fr) !important;"), "  "))
css.append(textwrap.indent(rule(NL.join([within(STRUCT, TILE_PSEUDO + "::before"), TILE_EL]), "display: none !important;"), "  "))
css.append(textwrap.indent(rule(within(STRUCT, f" > {HEAD} > *"), "grid-column: 1 !important;"), "  "))
css.append(textwrap.indent(rule(NL.join([f"{FLAT_NOG}::before", within(FLAT, FLAT_G)]), "display: none !important;"), "  "))
css.append(textwrap.indent(rule(within(FLAT, FLAT_BAND), "padding-left: var(--dg-pad) !important;"), "  "))
css.append("}\n")

OUT.write_text("".join(css), encoding="utf-8")
print(OUT, len("".join(css)))
