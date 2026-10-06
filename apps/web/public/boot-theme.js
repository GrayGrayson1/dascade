/*
 * DASCADE boot theme — a tiny classic script that runs in <head> before the first paint (served from
 * 'self', so the CSP allows it). It applies the stored theme's page background, colour scheme and
 * browser-chrome colour, so a non-default theme doesn't flash Delta Neon's near-black (incl. the
 * mobile address bar) while the app loads. The app's applyTheme() then takes over with the same values:
 * the rule below has the generated theme CSS's selector and comes earlier in <head>, so that CSS wins.
 *
 * THEMES must match packages/ui/src/theme/themes/*.ts: enforced by apps/web/src/themes/boot-theme.test.ts.
 * Delta Neon is the page default (index.html + tokens.css) and needs nothing here.
 */
/* global document, localStorage */
(function () {
  // id: [page background (--page-bg, resolved), <meta name="theme-color">, --theme-color-scheme]
  var THEMES = {
    'shareware-97': ['#2a0810', '#7a0f1c', 'dark'],
    'corporate-98': ['#3f7f82', '#3f7f82', 'light'],
    'cyber-cafe-01': ['#031530', '#062047', 'dark'],
    'mall-arcade-92': ['#0d0818', '#0d0818', 'dark'],
    'vhs-after-dark': ['#07080e', '#07080e', 'dark'],
    'space-casino-2088': ['#04061a', '#04061a', 'dark'],
    'lan-party': ['#0b0a08', '#0f0d0b', 'dark'],
    'saturday-morning': ['#2233b8', '#2233b8', 'dark'],
    executive: ['#160b07', '#160b07', 'dark'],
    'neon-noir': ['#030407', '#030407', 'dark'],
    'halloween-night': ['#0e0614', '#0e0614', 'dark'],
  };
  try {
    var raw = localStorage.getItem('dascade:v1:settings');
    var id = raw ? JSON.parse(raw).theme : null;
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(THEMES, id)) return;
    var t = THEMES[id];
    document.documentElement.setAttribute('data-theme', id);
    var style = document.createElement('style');
    style.id = 'dc-boot-theme';
    style.textContent = ":root[data-theme='" + id + "']{--page-bg:" + t[0] + ';--theme-color-scheme:' + t[2] + '}';
    document.head.appendChild(style);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t[1]);
  } catch (e) {
    /* storage disabled or corrupt settings: Delta Neon, exactly as the app itself falls back */
  }
})();
