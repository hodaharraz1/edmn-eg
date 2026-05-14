/* ================================================================
   EDMN | إضمن — Main JS v2.3
   ================================================================ */
'use strict';

var LANG_KEY = 'edmn-lang';

/* ── Set language (called early + on toggle) ── */
function setLanguage(lang, save) {
  var html = document.documentElement;
  html.setAttribute('lang', lang);
  html.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');

  /* Update all switcher button labels */
  document.querySelectorAll('.lang-btn-label').forEach(function(el) {
    el.textContent = lang === 'ar' ? 'EN' : 'عر';
  });
  document.querySelectorAll('.lang-switcher').forEach(function(btn) {
    btn.setAttribute('aria-label',
      lang === 'ar' ? 'Switch to English' : 'التبديل للعربية');
  });

  if (save !== false) {
    try { localStorage.setItem(LANG_KEY, lang); } catch(e) {}
  }
}

/* ── Init language from localStorage ── */
function initLanguage() {
  var saved;
  try { saved = localStorage.getItem(LANG_KEY); } catch(e) {}
  var lang = (saved === 'en') ? 'en' : 'ar';
  setLanguage(lang, false);
}

/* ── Wire all lang switcher buttons ── */
function initLangSwitcher() {
  document.querySelectorAll('.lang-switcher').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('lang') || 'ar';
      setLanguage(current === 'ar' ? 'en' : 'ar');
    });
  });
}

/* ── Navbar shadow on scroll ── */
var navbar      = document.getElementById('navbar');
var scrollTopBtn = document.getElementById('scroll-top');
var stickyCta   = document.getElementById('sticky-cta');

window.addEventListener('scroll', function() {
  var y = window.scrollY;
  if (navbar)       navbar.classList.toggle('scrolled', y > 20);
  if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', y > 400);
  if (stickyCta)    stickyCta.style.display = y > 300 ? 'block' : 'none';
}, { passive: true });

/* ── Mobile menu ── */
var burger     = document.getElementById('burger');
var mobileMenu = document.getElementById('mobile-menu');

function closeMobileMenu() {
  if (burger)     { burger.classList.remove('open'); burger.setAttribute('aria-expanded','false'); }
  if (mobileMenu) { mobileMenu.classList.remove('open'); mobileMenu.style.display = 'none'; }
  document.body.style.overflow = '';
}

if (burger && mobileMenu) {
  burger.addEventListener('click', function() {
    var open = burger.classList.toggle('open');
    mobileMenu.classList.toggle('open', open);
    mobileMenu.style.display = open ? 'flex' : 'none';
    document.body.style.overflow = open ? 'hidden' : '';
    burger.setAttribute('aria-expanded', String(open));
  });
  mobileMenu.querySelectorAll('a').forEach(function(l){ l.addEventListener('click', closeMobileMenu); });
  mobileMenu.addEventListener('click', function(e){ if (e.target === mobileMenu) closeMobileMenu(); });
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

/* ── Scroll animations ── */
if ('IntersectionObserver' in window) {
  var animEls = document.querySelectorAll('.fade-up,.fade-in,.slide-right,.slide-left');
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
  animEls.forEach(function(el) { io.observe(el); });
}

/* ── FAQ accordion ── */
document.querySelectorAll('.faq-item').forEach(function(item) {
  var q = item.querySelector('.faq-question');
  if (!q) return;
  q.setAttribute('tabindex','0'); q.setAttribute('role','button');
  q.addEventListener('click', function() {
    var wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(o){
      o.classList.remove('open');
      var oq = o.querySelector('.faq-question');
      if (oq) oq.setAttribute('aria-expanded','false');
    });
    if (!wasOpen) { item.classList.add('open'); q.setAttribute('aria-expanded','true'); }
  });
  q.addEventListener('keydown', function(e){
    if (e.key==='Enter'||e.key===' '){ e.preventDefault(); q.click(); }
  });
});

/* ── Counter animation ── */
function animateCounter(el) {
  var target = parseInt(el.dataset.target || el.textContent, 10);
  var suffix = el.dataset.suffix || '';
  var start  = performance.now();
  function step(now) {
    var p    = Math.min((now - start) / 1800, 1);
    var ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(ease * target) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
if ('IntersectionObserver' in window) {
  var counters = document.querySelectorAll('.counter');
  var cio = new IntersectionObserver(function(e){
    e.forEach(function(x){ if(x.isIntersecting){ animateCounter(x.target); cio.unobserve(x.target); }});
  }, { threshold: 0.5 });
  counters.forEach(function(el){ cio.observe(el); });
}

/* ── Init on DOM ready ── */
document.addEventListener('DOMContentLoaded', function() {
  initLanguage();
  initLangSwitcher();
});
