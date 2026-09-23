import { Component, computed, input } from '@angular/core';
import { HeaderWatermark } from '../header-watermark/header-watermark';
import { HeaderScreenKey, headerWatermarks } from '../header-watermark/header-watermarks';

/**
 * The header every screen opens with: a theme-gradient panel, the title block and a top-right action area.
 *
 * DECORATION is two layers, and a screen controls neither directly:
 *   1. BASE LAYER - a ring and a soft radial glow. Identical on every header and every theme colour; it lives in
 *      page-header.css and is not an input.
 *   2. WATERMARK - exactly one oversized outline icon, chosen for the screen in `headerWatermarks`
 *      (../header-watermark/header-watermarks.ts) and looked up here from `screen`.
 * Nothing else decorates a header: no icon clusters, no grids, no scattered shapes.
 *
 * It reads only --theme-* custom properties, so a theme change repaints every mounted header at once.
 *
 *   <app-page-header screen="campaign-register" title="Campaign register" subtitle="..." ownerLabel="Ravi K" updatedLabel="Updated 2 min ago">
 *     <span meta class="ph-chip">Scope: Organisation</span>
 *     <ng-container actions>
 *       <button type="button" class="ph-btn ph-btn--ghost">Filters</button>
 *       <button type="button" class="ph-btn ph-btn--primary">Create</button>
 *     </ng-container>
 *   </app-page-header>
 *
 * `screen` is the screen's key in `headerWatermarks` (its template name). It is required and typed as the union of
 * those keys, so a header without one, or with an unregistered one, does not compile.
 *
 * Projected content is styled by the global .ph-btn / .ph-chip classes (styles/ydot-theme.css) because
 * component-scoped CSS cannot reach into projected nodes.
 */
@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.html',
  styleUrl: './page-header.css',
  imports: [HeaderWatermark],
  // A static title="..." on <app-page-header> would also stay on the host as a DOM attribute and pop a
  // native tooltip over the whole panel; the value is only wanted as the input.
  host: { '[attr.title]': 'null' },
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null | undefined>('');

  /** Owner's name. The component supplies the "Owner:" prefix. */
  readonly ownerLabel = input<string | null | undefined>('');

  /** Full sentence, e.g. "Data updated 2 min ago" or "Last updated 12 Mar 2026". */
  readonly updatedLabel = input<string | null | undefined>('');

  /** Optional tooltip text for the info icon beside the title. */
  readonly info = input<string | null | undefined>('');

  /** The screen's key in `headerWatermarks`; it selects the header's one watermark icon. */
  readonly screen = input.required<HeaderScreenKey>();

  protected readonly watermark = computed(() => headerWatermarks[this.screen()]);
}
