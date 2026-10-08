import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Paints a red border on an input while it is invalid.
 *
 *   <input class="of-input" [dfInvalid]="!!error('code')">
 *
 * WHY A DIRECTIVE AND NOT CSS. The global theme styles inputs with `!important` rules that win over
 * the component stylesheet whatever its specificity (the inputs even kept the theme's 16px radius
 * when the form asked for 6px), so `.is-invalid { border-color: red !important }` never showed.
 * An inline style set with priority 'important' sits above every stylesheet rule, so this one
 * cannot be overridden by the theme.
 */
@Directive({
  selector: '[dfInvalid]',
  standalone: true,
})
export class InvalidBorderDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  /** True while the field is invalid. */
  readonly dfInvalid = input(false);

  private static readonly RED = '#d92d20';

  constructor() {
    effect(() => {
      const style = this.el.nativeElement.style;

      if (this.dfInvalid()) {
        style.setProperty('border-color', InvalidBorderDirective.RED, 'important');
        style.setProperty('border-width', '1px', 'important');
        style.setProperty('border-style', 'solid', 'important');
        style.setProperty('box-shadow', `inset 0 0 0 1px ${InvalidBorderDirective.RED}`, 'important');
      } else {
        style.removeProperty('border-color');
        style.removeProperty('border-width');
        style.removeProperty('border-style');
        style.removeProperty('box-shadow');
      }
    });
  }
}