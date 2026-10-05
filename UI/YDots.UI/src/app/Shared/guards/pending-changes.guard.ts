import { CanDeactivateFn } from '@angular/router';

/** A screen that can veto navigation while it holds work the person has not saved. */
export interface HasPendingChanges {
  /** True (or a promise of true) when it is fine to leave; false keeps the person here. */
  canDeactivate(): boolean | Promise<boolean>;
}

/**
 * Asks the screen before the router leaves it. Covers every way out - another menu item, the
 * Back button, the browser's back arrow - because they all go through the router.
 */
export const pendingChangesGuard: CanDeactivateFn<HasPendingChanges> = (component) =>
  component.canDeactivate ? component.canDeactivate() : true;
