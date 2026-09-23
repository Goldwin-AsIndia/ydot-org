import { Component, input } from '@angular/core';

/**
 * The app mark, recoloured by the theme.
 *
 * The logo asset is a raster (a PNG wrapped in an SVG), so its own pixels cannot be recoloured. Instead
 * it is kept neutral: a small alpha mask of the bird, painted with --theme-accent-ink, inside a rounded
 * badge filled with --theme-accent. That makes the logo the "pop" element against the primary-coloured
 * header, and it follows the theme with no asset regeneration.
 */
@Component({
  selector: 'app-themed-logo',
  templateUrl: './themed-logo.html',
  styleUrl: './themed-logo.css',
})
export class ThemedLogo {
  /** Badge edge length in px. */
  readonly size = input(44);

  /** Accessible name. Pass an empty string where the mark is purely decorative next to the app name. */
  readonly label = input('YDot');
}
