import { Component, input } from '@angular/core';
import { WatermarkIcon } from './header-watermarks';

/**
 * The single oversized line-art icon at the right of a page header.
 *
 * It takes exactly ONE `icon` (a `WatermarkIcon`, never a list), so a screen cannot stack a second icon on this
 * component: the type does not allow it. Which icon a screen gets is decided in `headerWatermarks`
 * (header-watermarks.ts), not here and not in a screen file. <app-page-header> is the only place this is used.
 *
 * Colour: stroke = --theme-on-primary at low opacity, so it can never introduce a hue of its own.
 */
@Component({
  selector: 'app-header-watermark',
  templateUrl: './header-watermark.html',
  styleUrl: './header-watermark.css',
})
export class HeaderWatermark {
  readonly icon = input.required<WatermarkIcon>();
}
