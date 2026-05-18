'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, X, Globe, UserPlus } from 'lucide-react';

const navLinks = [
  { key: 'home', href: '/' },
  { key: 'about', href: '/about' },
  { key: 'whyUs', href: '/why-us' },
  { key: 'howItWorks', href: '/how-it-works' },
  { key: 'faq', href: '/faq' },
  { key: 'blog', href: '/blog' },
  { key: 'contact', href: '/contact' },
] as const;

export default function Navbar() {
  const t = useTranslations('nav');
  const tb = useTranslations('beta');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [betaVisible, setBetaVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const switchLocale = useCallback(() => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    const segments = pathname.split('/');
    if (segments[1] === 'ar' || segments[1] === 'en') {
      segments[1] = newLocale;
    } else {
      segments.splice(1, 0, newLocale);
    }
    router.push(segments.join('/') || '/');
  }, [locale, pathname, router]);

  const isActive = (href: string) => {
    const base = locale === 'ar' ? '' : `/${locale}`;
    const fullHref = base + href;
    if (href === '/') return pathname === fullHref || pathname === `/${locale}`;
    return pathname.startsWith(fullHref);
  };

  const getLocalizedHref = (href: string) => {
    if (locale === 'ar') return href;
    return `/en${href}`;
  };

  return (
    <header className="fixed top-0 inset-x-0 z-[1000]">
      {/* Beta Banner */}
      {betaVisible && (
        <div className="beta-banner flex items-center justify-center gap-3 text-sm">
          <span>{tb('banner')}</span>
          <button
            onClick={() => setBetaVisible(false)}
            className="text-amber-200 hover:text-white transition-colors"
            aria-label="إغلاق"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Navbar */}
      <nav
        className={cn(
          'bg-white/95 backdrop-blur-xl border-b border-transparent transition-all duration-300',
          scrolled && 'border-[var(--color-border)] shadow-[var(--shadow-sm)]',
        )}
        aria-label={locale === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}
      >
        <div className="container">
          <div className="flex items-center justify-between h-[72px] gap-4">

            {/* Logo */}
            <Link
              href={getLocalizedHref('/')}
              className="flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A57A1] rounded-lg"
              aria-label={locale === 'ar' ? 'إضمن — الصفحة الرئيسية' : 'EDMN — Home'}
            >
              <div className="flex items-center gap-2">
                <span className="text-[#1A57A1] font-extrabold text-2xl tracking-tight">إضمن</span>
                <span className="text-[#F0171A] font-bold text-xs px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-amber-700">Beta</span>
              </div>
            </Link>

            {/* Desktop Links */}
            <ul className="hidden lg:flex items-center gap-1 flex-1 justify-center" role="list">
              {navLinks.map(({ key, href }) => (
                <li key={key}>
                  <Link
                    href={getLocalizedHref(href)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200',
                      'hover:text-[#1A57A1] hover:bg-[#EBF2FC]',
                      'relative',
                      isActive(href)
                        ? 'text-[#1A57A1] bg-[#EBF2FC]'
                        : 'text-[#1F2937]',
                    )}
                  >
                    {t(key as any)}
                  </Link>
                </li>
              ))}
            </ul>

            {/* Right Actions */}
            <div className="hidden lg:flex items-center gap-3 flex-shrink-0">
              {/* Language Switch */}
              <button
                onClick={switchLocale}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-[#4B5563] hover:text-[#1A57A1] hover:bg-[#EBF2FC] transition-all"
                aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
              >
                <Globe size={16} />
                {t('switchLang')}
              </button>

              {/* CTA */}
              <Link
                href="#"
                className="flex items-center gap-2 px-5 py-2.5 bg-[#F0171A] text-white rounded-lg text-sm font-bold shadow-[0_4px_14px_rgba(240,23,26,.3)] hover:bg-[#C8141C] hover:shadow-[0_6px_20px_rgba(240,23,26,.4)] hover:-translate-y-0.5 transition-all"
                aria-label={locale === 'ar' ? 'سجل الآن مجاناً' : 'Sign Up Free'}
              >
                <UserPlus size={16} />
                {t('register')}
              </Link>
            </div>

            {/* Mobile Burger */}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="lg:hidden p-2 rounded-lg hover:bg-[#EBF2FC] transition-colors"
              aria-label={menuOpen ? t('closeMenu') : t('openMenu')}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div
        id="mobile-menu"
        role="dialog"
        aria-label={locale === 'ar' ? 'القائمة المتنقلة' : 'Mobile menu'}
        aria-modal="true"
        className={cn(
          'lg:hidden fixed inset-x-0 bg-white/98 backdrop-blur-xl z-[999]',
          'flex flex-col gap-1 p-6 border-b border-[var(--color-border)] shadow-[var(--shadow-xl)]',
          'transition-all duration-300 ease-[var(--ease-smooth)]',
          menuOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-4 pointer-events-none',
        )}
        style={{ top: betaVisible ? '110px' : '72px' }}
      >
        <nav className="flex flex-col gap-1" aria-label={locale === 'ar' ? 'قائمة التنقل' : 'Navigation'}>
          {navLinks.map(({ key, href }) => (
            <Link
              key={key}
              href={getLocalizedHref(href)}
              onClick={closeMenu}
              className={cn(
                'px-4 py-3 rounded-xl text-base font-bold transition-all',
                isActive(href)
                  ? 'text-[#1A57A1] bg-[#EBF2FC]'
                  : 'text-[#1F2937] hover:text-[#1A57A1] hover:bg-[#EBF2FC]',
              )}
            >
              {t(key as any)}
            </Link>
          ))}
        </nav>

        <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex flex-col gap-3">
          <button
            onClick={() => { switchLocale(); closeMenu(); }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-[#4B5563] hover:text-[#1A57A1] hover:bg-[#EBF2FC] transition-all"
          >
            <Globe size={16} />
            {t('switchLang')}
          </button>
          <Link
            href="#"
            onClick={closeMenu}
            className="flex items-center justify-center gap-2 px-6 py-3.5 bg-[#F0171A] text-white rounded-xl text-base font-bold shadow-[0_4px_14px_rgba(240,23,26,.3)] hover:bg-[#C8141C] transition-all"
          >
            <UserPlus size={18} />
            {t('register')}
          </Link>
        </div>
      </div>

      {/* Mobile menu backdrop */}
      {menuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-[998]"
          style={{ top: betaVisible ? '110px' : '72px' }}
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}
    </header>
  );
}
