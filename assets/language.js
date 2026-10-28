// Loaded before the stylesheet on language-neutral entry URLs only.
(() => {
  let preferred;
  try { preferred = localStorage.getItem('sheetbase-docs-language'); } catch {}
  if (preferred !== 'en' && preferred !== 'sk') {
    const browser = navigator.languages?.[0] || navigator.language || 'en';
    preferred = /^sk(?:-|$)/i.test(browser) ? 'sk' : 'en';
  }
  const alternate = document.querySelector(`link[rel="alternate"][hreflang="${preferred}"]`);
  if (!alternate) return;
  const target = new URL(alternate.href, location.href);
  target.search = location.search;
  target.hash = location.hash;
  if (target.href !== location.href) location.replace(target.href);
})();
