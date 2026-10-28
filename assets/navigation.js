import {copyText} from './clipboard.js';
const english = document.documentElement.lang === 'en';
const menu = document.querySelector('.menu-button');
function closeMenu() {
  document.body.classList.remove('nav-open');
  menu?.setAttribute('aria-expanded', 'false');
}
menu?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menu.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.sidebar a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    closeMenu(); menu?.focus();
  }
});
document.querySelectorAll('[data-language-switch]').forEach(link => {
  const url = new URL(link.href);
  if (link.hasAttribute('data-preserve-hash')) url.hash = location.hash;
  link.href = url.href;
});
window.addEventListener('hashchange', () => {
  document.querySelectorAll('[data-language-switch]').forEach(link => {
    const url = new URL(link.href); if (link.hasAttribute('data-preserve-hash')) url.hash = location.hash; link.href = url.href;
  });
});
document.querySelectorAll('[data-copy-code]').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      await copyText(button.closest('.doc-code').querySelector('code').textContent);
      button.textContent = english ? 'Copied ✓' : 'Skopírované ✓';
    } catch { button.textContent = english ? 'Select and copy the code' : 'Označ a skopíruj kód'; }
  });
});
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      document.querySelectorAll('.sidebar a.active').forEach(link => link.classList.remove('active'));
      document.querySelector(`.sidebar a[href="#${entry.target.id}"]`)?.classList.add('active');
    }
  }, { rootMargin: '-10% 0px -65% 0px' });
  document.querySelectorAll('main > section').forEach(section => observer.observe(section));
}
