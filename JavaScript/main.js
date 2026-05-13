/* ================================================================
   EDMN | إضمن — Main JS v2.1  (bilingual fixed + enterprise)
   ================================================================ */
'use strict';

/* ── Language Switcher ── */
const LANG_KEY = 'edmn-lang';

function setLanguage(lang, save) {
  if (save === undefined) save = true;
  const html = document.documentElement;

  // Set direction and lang
  html.setAttribute('lang', lang);
  html.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');

  // Update ALL switcher buttons text
  document.querySelectorAll('.lang-btn-label').forEach(function(el) {
    el.textContent = lang === 'ar' ? 'EN' : 'عر';
  });

  // Update aria-label
  document.querySelectorAll('.lang-switcher').forEach(function(btn) {
    btn.setAttribute('aria-label',
      lang === 'ar' ? 'Switch to English' : 'التبديل للعربية');
  });

  // Save preference
  if (save) {
    try { localStorage.setItem(LANG_KEY, lang); } catch(e) {}
  }
}

function initLanguage() {
  var saved;
  try { saved = localStorage.getItem(LANG_KEY); } catch(e) {}
  // Default is Arabic (already set in HTML), only switch if saved EN
  if (saved === 'en') {
    setLanguage('en', false);
  }
  // Update button label for default Arabic
  document.querySelectorAll('.lang-btn-label').forEach(function(el) {
    el.textContent = 'EN';
  });
}

// Wire up all lang switcher buttons (desktop + mobile)
function initLangSwitcher() {
  document.querySelectorAll('.lang-switcher').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('lang') || 'ar';
      setLanguage(current === 'ar' ? 'en' : 'ar');
    });
  });
}

/* ── Navbar scroll shadow ── */
var navbar      = document.getElementById('navbar');
var scrollTopBtn = document.getElementById('scroll-top');
var stickyCta   = document.getElementById('sticky-cta');

window.addEventListener('scroll', function() {
  var y = window.scrollY;
  if (navbar)      navbar.classList.toggle('scrolled', y > 20);
  if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', y > 400);
  if (stickyCta)   stickyCta.style.display = y > 300 ? 'block' : 'none';
}, { passive: true });

/* ── Mobile menu ── */
var burger      = document.getElementById('burger');
var mobileMenu  = document.getElementById('mobile-menu');

function closeMobileMenu() {
  if (burger)     burger.classList.remove('open');
  if (mobileMenu) {
    mobileMenu.classList.remove('open');
    mobileMenu.style.display = 'none';
  }
  document.body.style.overflow = '';
  if (burger) burger.setAttribute('aria-expanded', 'false');
}

if (burger && mobileMenu) {
  burger.addEventListener('click', function() {
    var open = burger.classList.toggle('open');
    mobileMenu.classList.toggle('open', open);
    mobileMenu.style.display = open ? 'flex' : 'none';
    document.body.style.overflow = open ? 'hidden' : '';
    burger.setAttribute('aria-expanded', open);
  });

  mobileMenu.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', closeMobileMenu);
  });

  mobileMenu.addEventListener('click', function(e) {
    if (e.target === mobileMenu) closeMobileMenu();
  });
}

/* ── Scroll to top ── */
if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ── Active nav link ── */
var currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link').forEach(function(link) {
  var href = (link.getAttribute('href') || '').split('/').pop();
  if (href === currentPage) link.classList.add('active');
});

/* ── Intersection Observer — scroll animations ── */
var animEls = document.querySelectorAll('.fade-up,.fade-in,.slide-right,.slide-left');
if (animEls.length && 'IntersectionObserver' in window) {
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.10, rootMargin: '0px 0px -40px 0px' });
  animEls.forEach(function(el) { io.observe(el); });
}

/* ── FAQ Accordion ── */
document.querySelectorAll('.faq-item').forEach(function(item) {
  var q = item.querySelector('.faq-question');
  if (!q) return;
  q.setAttribute('tabindex', '0');
  q.setAttribute('role', 'button');

  q.addEventListener('click', function() {
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(o) {
      o.classList.remove('open');
      var oq = o.querySelector('.faq-question');
      if (oq) oq.setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      item.classList.add('open');
      q.setAttribute('aria-expanded', 'true');
    }
  });

  q.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q.click(); }
  });
});

/* ── Counter animation ── */
function animateCounter(el) {
  var target = parseInt(el.dataset.target || el.textContent, 10);
  var suffix = el.dataset.suffix || '';
  var dur    = 1800;
  var start  = performance.now();
  function step(now) {
    var p    = Math.min((now - start) / dur, 1);
    var ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(ease * target) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

var counters = document.querySelectorAll('.counter');
if (counters.length && 'IntersectionObserver' in window) {
  var cio = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { animateCounter(e.target); cio.unobserve(e.target); }
    });
  }, { threshold: 0.5 });
  counters.forEach(function(el) { cio.observe(el); });
}

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', function() {
  initLanguage();
  initLangSwitcher();
});
