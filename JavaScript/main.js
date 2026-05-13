/* ================================================================
   EDMN | إضمن — Main JS v2.0  (bilingual + enterprise)
   ================================================================ */
'use strict';

/* ── Language Switcher ── */
const LANG_KEY = 'edmn-lang';

function setLanguage(lang, save = true) {
  const html = document.documentElement;
  html.lang = lang;
  html.dir  = lang === 'en' ? 'ltr' : 'rtl';
  if (save) localStorage.setItem(LANG_KEY, lang);

  // Update switcher button text
  document.querySelectorAll('.lang-btn-label').forEach(el => {
    el.textContent = lang === 'ar' ? 'EN' : 'عر';
  });

  // Update aria-label on switcher
  document.querySelectorAll('.lang-switcher').forEach(btn => {
    btn.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل للعربية');
  });

  // Update nav active states (page might have both ar/en nav link text)
  document.querySelectorAll('[data-ar][data-en]').forEach(el => {
    el.textContent = lang === 'ar' ? el.dataset.ar : el.dataset.en;
  });
}

function initLanguage() {
  const saved = localStorage.getItem(LANG_KEY);
  const preferred = saved || (navigator.language.startsWith('ar') ? 'ar' : 'ar'); // default AR
  setLanguage(preferred, false);
}

document.addEventListener('DOMContentLoaded', () => {
  initLanguage();

  document.querySelectorAll('.lang-switcher').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.lang;
      setLanguage(current === 'ar' ? 'en' : 'ar');
    });
  });
});

/* ── Navbar scroll shadow ── */
const navbar = document.getElementById('navbar');
const scrollTopBtn = document.getElementById('scroll-top');
const stickyCta = document.getElementById('sticky-cta');

window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (navbar)      navbar.classList.toggle('scrolled', y > 20);
  if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', y > 400);
  if (stickyCta)   stickyCta.style.display = y > 300 ? 'block' : 'none';
}, { passive: true });

/* ── Mobile menu ── */
const burger     = document.getElementById('burger');
const mobileMenu = document.getElementById('mobile-menu');

if (burger && mobileMenu) {
  burger.addEventListener('click', () => {
    const open = burger.classList.toggle('open');
    mobileMenu.classList.toggle('open', open);
    mobileMenu.style.display = open ? 'flex' : 'none';
    document.body.style.overflow = open ? 'hidden' : '';
    burger.setAttribute('aria-expanded', open);
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMobileMenu);
  });

  mobileMenu.addEventListener('click', e => {
    if (e.target === mobileMenu) closeMobileMenu();
  });
}

function closeMobileMenu() {
  burger?.classList.remove('open');
  mobileMenu?.classList.remove('open');
  if (mobileMenu) mobileMenu.style.display = 'none';
  document.body.style.overflow = '';
  burger?.setAttribute('aria-expanded', 'false');
}

/* ── Scroll to top ── */
if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ── Active nav link ── */
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link').forEach(link => {
  const href = link.getAttribute('href')?.split('/').pop() || '';
  if (href === currentPage) link.classList.add('active');
});

/* ── Intersection Observer — scroll animations ── */
const animEls = document.querySelectorAll('.fade-up,.fade-in,.slide-right,.slide-left');
if (animEls.length) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.10, rootMargin: '0px 0px -40px 0px' });
  animEls.forEach(el => io.observe(el));
}

/* ── FAQ Accordion ── */
document.querySelectorAll('.faq-item').forEach(item => {
  const q = item.querySelector('.faq-question');
  if (!q) return;

  q.setAttribute('tabindex', '0');
  q.setAttribute('role', 'button');

  q.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(o => o.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
    q.setAttribute('aria-expanded', !isOpen);
  });

  q.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q.click(); }
  });
});

/* ── Counter animation ── */
function animateCounter(el) {
  const target  = parseInt(el.dataset.target || el.textContent, 10);
  const suffix  = el.dataset.suffix || '';
  const dur     = 1800;
  const start   = performance.now();
  const step = now => {
    const p = Math.min((now - start) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(ease * target) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const counters = document.querySelectorAll('.counter');
if (counters.length) {
  const cio = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { animateCounter(e.target); cio.unobserve(e.target); } });
  }, { threshold: 0.5 });
  counters.forEach(el => cio.observe(el));
}

/* ── Contact form (Formspree handles submission natively) ── */
const contactForm = document.getElementById('contact-form');
if (contactForm && contactForm.getAttribute('action')?.includes('formspree')) {
  contactForm.addEventListener('submit', () => {
    const btn = contactForm.querySelector('[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '...جاري الإرسال'; }
  });
}
