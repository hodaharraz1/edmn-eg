/* ============================================
   EDMN | إضمن — Main JavaScript
   ============================================ */

'use strict';

/* ─── Navigation ─── */
const navbar  = document.getElementById('navbar');
const burger  = document.getElementById('burger');
const mobileMenu = document.getElementById('mobile-menu');

// Scroll → add shadow to navbar
window.addEventListener('scroll', () => {
  if (!navbar) return;
  navbar.classList.toggle('scrolled', window.scrollY > 20);
  scrollTopBtn && scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
}, { passive: true });

// Mobile menu toggle
if (burger && mobileMenu) {
  burger.addEventListener('click', () => {
    const open = burger.classList.toggle('open');
    mobileMenu.classList.toggle('open', open);
    mobileMenu.style.display = open ? 'flex' : 'none';
    document.body.style.overflow = open ? 'hidden' : '';
    burger.setAttribute('aria-expanded', open);
  });

  // Close on link click
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('open');
      mobileMenu.classList.remove('open');
      mobileMenu.style.display = 'none';
      document.body.style.overflow = '';
      burger.setAttribute('aria-expanded', 'false');
    });
  });

  // Close on backdrop click
  mobileMenu.addEventListener('click', e => {
    if (e.target === mobileMenu) {
      burger.classList.remove('open');
      mobileMenu.classList.remove('open');
      mobileMenu.style.display = 'none';
      document.body.style.overflow = '';
    }
  });
}

// Active nav link based on current page
const currentPath = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link').forEach(link => {
  const href = link.getAttribute('href')?.split('/').pop() || '';
  if (href === currentPath || (currentPath === 'index.html' && href === '' ) ) {
    link.classList.add('active');
  }
});

/* ─── Scroll to Top ─── */
const scrollTopBtn = document.getElementById('scroll-top');
if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ─── Intersection Observer — Scroll Animations ─── */
const animatedEls = document.querySelectorAll('.fade-up, .fade-in, .slide-right, .slide-left');
if (animatedEls.length) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  animatedEls.forEach(el => observer.observe(el));
}

/* ─── Countdown Timer ─── */
function initCountdown() {
  const launchDate = new Date('2025-07-01T00:00:00').getTime();
  const now = Date.now();

  const daysEl    = document.getElementById('cd-days');
  const hoursEl   = document.getElementById('cd-hours');
  const minsEl    = document.getElementById('cd-mins');
  const secsEl    = document.getElementById('cd-secs');
  const monthsEl  = document.getElementById('cd-months');

  if (!daysEl) return;

  function update() {
    const diff = Math.max(0, launchDate - Date.now());
    if (diff === 0) {
      [daysEl, hoursEl, minsEl, secsEl].forEach(el => { if (el) el.textContent = '00'; });
      if (monthsEl) monthsEl.textContent = '00';
      return;
    }

    const totalSecs  = Math.floor(diff / 1000);
    const secs       = totalSecs % 60;
    const totalMins  = Math.floor(totalSecs / 60);
    const mins       = totalMins % 60;
    const totalHours = Math.floor(totalMins / 60);
    const hours      = totalHours % 24;
    const totalDays  = Math.floor(totalHours / 24);
    const months     = Math.floor(totalDays / 30);
    const days       = totalDays % 30;

    const pad = n => String(n).padStart(2, '0');
    if (monthsEl)  monthsEl.textContent = pad(months);
    if (daysEl)    daysEl.textContent   = pad(days);
    if (hoursEl)   hoursEl.textContent  = pad(hours);
    if (minsEl)    minsEl.textContent   = pad(mins);
    if (secsEl)    secsEl.textContent   = pad(secs);
  }

  update();
  setInterval(update, 1000);
}

initCountdown();

/* ─── FAQ Accordion ─── */
document.querySelectorAll('.faq-item').forEach(item => {
  const question = item.querySelector('.faq-question');
  const answer   = item.querySelector('.faq-answer');
  if (!question || !answer) return;

  question.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');

    // Close all
    document.querySelectorAll('.faq-item.open').forEach(openItem => {
      openItem.classList.remove('open');
      openItem.querySelector('.faq-answer').style.maxHeight = null;
    });

    // Open clicked (if it wasn't already open)
    if (!isOpen) {
      item.classList.add('open');
    }
  });

  // Keyboard support
  question.setAttribute('tabindex', '0');
  question.setAttribute('role', 'button');
  question.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); question.click(); }
  });
});

/* ─── Counter Animation ─── */
function animateCounter(el) {
  const target = parseInt(el.dataset.target || el.textContent, 10);
  const suffix = el.dataset.suffix || '';
  const duration = 1800;
  const start = performance.now();

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.floor(ease * target) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

const counters = document.querySelectorAll('.counter');
if (counters.length) {
  const counterObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => counterObserver.observe(el));
}

/* ─── Contact Form ─── */
const contactForm = document.getElementById('contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', e => {
    e.preventDefault();
    const btn = contactForm.querySelector('[type="submit"]');
    const original = btn.textContent;
    btn.textContent = 'جاري الإرسال...';
    btn.disabled = true;

    setTimeout(() => {
      btn.textContent = 'تم الإرسال بنجاح ✓';
      btn.style.background = '#166534';
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
        btn.style.background = '';
        contactForm.reset();
      }, 3000);
    }, 1200);
  });
}
