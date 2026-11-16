/* js/boot.js — applies the saved light/dark theme before the page paints (classic script, no modules). */
(function () {
  try { var t = localStorage.getItem('dt-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch { /* ignore */ }
})();
