import { Route } from '@angular/router';
import { routes } from '../../app.routes';
import { SIGN_IN_ROUTES } from './auth.model';

/**
 * Every screen a sign-in answer sends somebody to has to exist.
 *
 * `mfaRequired` pointed at /auth/mfa-challenge while the router only knew /auth/mfa, so the
 * wildcard sent the person back to the sign-in form and the button stayed on "Signing in...".
 */
describe('SIGN_IN_ROUTES', () => {
  function paths(list: Route[], prefix = ''): string[] {
    return list.flatMap((route) => {
      const own = [prefix, route.path ?? ''].filter(Boolean).join('/');
      return [own, ...paths(route.children ?? [], own)];
    });
  }

  it('names only routes the router has', () => {
    const known = new Set(paths(routes));

    for (const [status, target] of Object.entries(SIGN_IN_ROUTES)) {
      expect(known.has(target.replace(/^\//, '')), `${status} -> ${target}`).toBe(true);
    }
  });
});
