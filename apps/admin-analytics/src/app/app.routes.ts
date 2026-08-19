import { Route } from '@angular/router';

/**
 * The console is effectively one screen, and which screen you get is decided
 * by AUTH STATE, not by a URL. AppComponent switches between login /
 * access-denied / dashboard from signals (see app.component.ts for why a
 * router guard would be the wrong mechanism here), so this table only needs
 * to keep every path on the shell.
 *
 * The router is kept wired up (rather than removed) so a future second screen
 * - a per-project drill-down, an audit log - can be added as a real route
 * without re-plumbing bootstrap.
 */
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', children: [] },
  // Anything else (including a stale deep link from a previous version) lands
  // back on the shell rather than a blank page.
  { path: '**', redirectTo: '' },
];
