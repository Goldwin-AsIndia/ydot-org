import { Component, OnDestroy, computed, inject } from '@angular/core';
import { ThemeColorService } from '../../theme/theme-color.service';
import { contrastOn } from '../../theme/theme-palette';
import { THEME_COLOR_PRESETS, ThemeColorPreset } from '../../theme/theme-presets';

/** Fastest the live colour drag restyles the app: ~16 updates a second is smooth to look at and cheap to render. */
const LIVE_MIN_INTERVAL_MS = 60;

/**
 * Palette of curated swatches plus a native colour input for a custom pick. Selecting either calls
 * ThemeColorService.setThemeColor(), and because every themed surface reads the same --theme-* custom
 * properties, all mounted headers, logos, icons and buttons update on the next paint with no reload.
 *
 * Keyboard: the swatches are a native radio group (Tab into the group, arrow keys move and select),
 * and the custom picker is a native colour input (Tab to it, Enter/Space opens the browser's picker).
 * Every swatch has a text name; the selected one is also marked with a check, never by colour alone.
 */
@Component({
  selector: 'app-theme-picker',
  templateUrl: './theme-picker.html',
  styleUrl: './theme-picker.css',
})
export class ThemePicker implements OnDestroy {
  private readonly theme = inject(ThemeColorService);

  readonly presets = THEME_COLOR_PRESETS;
  readonly current = this.theme.themeColor;

  readonly selectedPreset = computed<ThemeColorPreset | undefined>(() =>
    this.presets.find(p => p.hex === this.current()),
  );

  readonly isCustom = computed(() => !this.selectedPreset());

  /** Check-mark colour that stays readable on the swatch, whatever colour it is. */
  readonly checkColor = contrastOn;

  select(hex: string): void {
    this.theme.setThemeColor(hex);
  }

  /**
   * The native colour input fires `input` for every mouse move while the pointer is dragged over its spectrum, and
   * each colour change restyles the whole app. Applying every event made the drag stutter, so the live path is
   * rate-limited: the newest value is applied at most once per animation frame AND at most every
   * LIVE_MIN_INTERVAL_MS, and stale values in between are dropped (only the latest matters). `change` (the picker
   * committing) applies the final value straight away and saves it.
   */
  onCustomInput(event: Event): void {
    this.pendingHex = (event.target as HTMLInputElement).value;
    this.scheduleLive();
  }

  onCustomCommit(event: Event): void {
    this.cancelLive();
    this.theme.setThemeColor((event.target as HTMLInputElement).value);
  }

  ngOnDestroy(): void {
    this.cancelLive();
  }

  private pendingHex: string | null = null;
  private rafId = 0;
  private lastLiveAt = 0;

  private scheduleLive(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(now => {
      this.rafId = 0;
      if (this.pendingHex === null) return;
      if (now - this.lastLiveAt < LIVE_MIN_INTERVAL_MS) {
        this.scheduleLive(); // too soon: keep the newest value and look again next frame
        return;
      }
      this.lastLiveAt = now;
      const hex = this.pendingHex;
      this.pendingHex = null;
      this.theme.previewThemeColor(hex);
    });
  }

  private cancelLive(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.pendingHex = null;
  }
}
