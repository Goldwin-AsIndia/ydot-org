// Generates src/app/Shared/sidebar/sidebar-icons.css — the hairline menu icon set.
// Each icon is a 24-grid stroke drawing (no fills), rendered as a CSS mask so it takes `currentColor`.
// Run: node tools/gen_sidebar_icons.js
const fs = require('fs');
const path = require('path');
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r=".8" fill="#000" stroke="none"/>`;
const ring = (r = 8.5) => `<circle cx="12" cy="12" r="${r}"/>`;
const tick = 'm8.8 12.2 2.2 2.2 4.2-4.4';
const icons = {
  grid: '<rect x="3.5" y="3.5" width="7" height="10" rx="2"/><rect x="3.5" y="16.5" width="7" height="4" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4" rx="1.5"/><rect x="13.5" y="10.5" width="7" height="10" rx="2"/>',
  settings: '<circle cx="12" cy="12" r="2.8"/><path d="M10.4 3.5h3.2l.6 2.4 1.5.9 2.3-.8 1.6 2.8-1.8 1.7v1.8l1.8 1.7-1.6 2.8-2.3-.8-1.5.9-.6 2.4h-3.2l-.6-2.4-1.5-.9-2.3.8-1.6-2.8 1.8-1.7v-1.8L4.4 8.8 6 6l2.3.8 1.5-.9z"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5.5H9V20H5a1 1 0 0 1-1-1z"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/>',
  'dollar-sign': '<path d="M5 7.5h12.5a2 2 0 0 1 2 2V18a1.5 1.5 0 0 1-1.5 1.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5h10"/>' + dot(16, 13.8),
  'credit-card': '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h3"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
  building: '<path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v15.5M15 9.5h2.5A1.5 1.5 0 0 1 19 11v9.5M3 20.5h18M8.5 7.5h3M8.5 11h3M8.5 14.5h3"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  book: '<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5zM5 17.5A2.5 2.5 0 0 1 7.5 15H18M9 8h5"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17M11 13h2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>' + dot(8, 14.5) + dot(12, 14.5) + dot(16, 14.5),
  'check-circle': ring() + `<path d="${tick}"/>`,
  'check-square': `<rect x="4" y="4" width="16" height="16" rx="4"/><path d="${tick}"/>`,
  clipboard: '<rect x="5" y="4.5" width="14" height="16" rx="3"/><path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5M9 11h6M9 15h4"/>',
  clock: ring() + '<path d="M12 7.5V12l3 2"/>',
  'corner-up-left': '<path d="M9 5 4.5 9.5 9 14M4.5 9.5H15a4.5 4.5 0 0 1 4.5 4.5v5"/>',
  edit: '<path d="M4.5 19.5 5.3 15.8 16 5.1a2.1 2.1 0 0 1 3 3L8.2 18.7zM14 7.2l2.8 2.8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  file: '<path d="M13 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9.5zM13 3.5V9a.5.5 0 0 0 .5.5H19"/>',
  'file-text': '<path d="M13 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9.5zM13 3.5V9a.5.5 0 0 0 .5.5H19M8.5 13.5h7M8.5 17h5"/>',
  flag: '<path d="M5.5 21V4M5.5 5h11l-2 3.5 2 3.5h-11"/>',
  'git-branch': '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><path d="M6.5 7.5v9M17.5 10.5c0 4-5 3-10 6"/>',
  globe: ring() + '<path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z"/>',
  inbox: '<path d="M3.5 13.5 6 5.5a1.5 1.5 0 0 1 1.4-1h9.2a1.5 1.5 0 0 1 1.4 1l2.5 8v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 13.5h5l1 2h5l1-2h5"/>',
  info: ring() + '<path d="M12 11v5"/>' + dot(12, 8),
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12 20 3M16.5 6.5 19 9M14 9l2 2"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8zM3.5 12.2 12 16.7l8.5-4.5M3.5 16 12 20.5l8.5-4.5"/>',
  layout: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17M9.5 9v11"/>',
  'life-buoy': ring() + '<circle cx="12" cy="12" r="3.5"/><path d="m6 6 3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/>' + dot(4.5, 6.5) + dot(4.5, 12) + dot(4.5, 17.5),
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/>',
  map: '<path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13l-5.5 2.5-6-2.5-5.5 2.5zM9 4v13M15 6.5V20"/>',
  'map-pin': '<path d="M12 21s6.5-5.7 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.3 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  'message-circle': '<path d="M4 19.5l1.2-3.8A8 8 0 1 1 8.4 18.8z"/><path d="M8.5 11h7M8.5 14h4"/>',
  package: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9zM3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  'plus-circle': ring() + '<path d="M12 8.5v7M8.5 12h7"/>',
  'refresh-cw': '<path d="M19.5 12a7.5 7.5 0 0 1-13 5M4.5 12a7.5 7.5 0 0 1 13-5M17.5 3.5V7H14M6.5 20.5V17H10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  send: '<path d="M20.5 3.5 3.5 10.5l6.5 2.5 2.5 6.5zM10 13l5.5-5.5"/>',
  'share-2': '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.2 10.8 7-4M8.2 13.2l7 4"/>',
  shield: `<path d="M12 3.5 19.5 6v6c0 4.3-3.2 7.3-7.5 8.5C7.7 19.3 4.5 16.3 4.5 12V6z"/><path d="${tick}"/>`,
  shuffle: '<path d="M3.5 7h3.5c5 0 5 10 10 10h3M3.5 17h3.5c1.8 0 3-.9 4-2M14 9c1-1.2 2-2 3.2-2h3.3M18 4l2.5 3-2.5 3M18 14l2.5 3-2.5 3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  tag: '<path d="M3.5 4.5a1 1 0 0 1 1-1h7.6a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-7.6 7.6a1 1 0 0 1-1.4 0L3.8 12.8a1 1 0 0 1-.3-.7z"/>' + dot(8.3, 8.3),
  'trending-up': '<path d="m3.5 17 6-6 4 4 7-8M15 7h5.5v5.5"/>',
  truck: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14v11H3zM14 9h4l3 3.5V16h-7z"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  'user-plus': '<circle cx="10" cy="8" r="3.8"/><path d="M3.5 20c.7-3.6 3.2-5.5 6.5-5.5 1.5 0 2.8.4 3.8 1.1M18 14v6M15 17h6"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.8 20c.6-3.5 3-5.3 6.2-5.3s5.6 1.8 6.2 5.3M16 5.3a3.4 3.4 0 0 1 0 6.4M18 14.9c1.8.7 3 2.3 3.4 5.1"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7 16.7 3.5 12 3.5z"/>' + dot(7.5, 11) + dot(10, 7.5) + dot(14.5, 7.5),
  dot: ring() + dot(12, 12),
};
const W = 1.1;
let css = '/* GENERATED by tools/gen_sidebar_icons.js - do not edit by hand. Hairline menu icons (stroke ' + W + ', no fills). */\n';
css += '.sbm{display:block;inline-size:calc(19px * var(--ui-scale, 1) * var(--ui-text-scale, 1)) !important;block-size:calc(19px * var(--ui-scale, 1) * var(--ui-text-scale, 1)) !important;background-color:currentColor;-webkit-mask:var(--sb-i) center/contain no-repeat;mask:var(--sb-i) center/contain no-repeat;}\n';
const names = {};
Object.entries(icons).forEach(([name, body], i) => {
  names[name] = 'sbm-x' + i;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  css += `.sbm-x${i}{--sb-i:url("data:image/svg+xml,${encodeURIComponent(svg)}");}\n`;
});
fs.writeFileSync(path.join(__dirname, '../src/app/Shared/sidebar/sidebar-icons.css'), css);
// Class names are indexed, not spelled out: the global stylesheet restyles any class containing words such as
// "card" or "icon", which blanked the credit-card glyph. See ydot-ui-global-style-traps.
fs.writeFileSync(path.join(__dirname, '../src/app/Shared/sidebar/sidebar-icon-classes.ts'),
  '// GENERATED by tools/gen_sidebar_icons.js - do not edit by hand.\nexport const SIDEBAR_ICON_CLASS: Record<string, string> = ' + JSON.stringify(names, null, 2) + ';\n');
console.log(Object.keys(icons).length + ' icons');
