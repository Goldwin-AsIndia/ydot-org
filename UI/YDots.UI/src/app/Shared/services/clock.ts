/**
 * The present moment and the viewer's time zone, for the "as of" and "effective time" lines the
 * campaign screens print.
 *
 * THESE WERE LITERALS. Four screens carried 'Today, 09:30 AM · IST' as their last-refresh time and
 * 'Asia/Kolkata · IST (UTC+05:30)' as their time zone, so every confirmation dialog recorded the
 * same effective time whatever the clock said, and a date typed by somebody in another zone was
 * labelled as Indian time. Both are read from the browser here: the dates on these screens are
 * interpreted in the viewer's own zone, so that is the zone to name.
 */

/** The current moment as a person reads it: "09 Oct 2026, 08:45 am". */
export function nowLabel(): string {
  return new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** The viewer's time zone with its offset: "Asia/Kolkata (UTC+05:30)". */
export function viewerTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';

  // getTimezoneOffset is minutes BEHIND UTC, so its sign is the reverse of the one printed.
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const hours = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0');
  const rest = String(Math.abs(minutes) % 60).padStart(2, '0');

  return `${zone} (UTC${sign}${hours}:${rest})`;
}
