'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, X, Globe, UserPlus } from 'lucide-react';

const navLinks = [
  { key: 'home',       href: '/' },
  { key: 'whyUs',      href: '/why-us' },
  { key: 'howItWorks', href: '/how-it-works' },
  { key: 'faq',        href: '/faq' },
  { key: 'blog',       href: '/blog' },
  { key: 'contact',    href: '/contact' },
] as const;

export default function Navbar() {
  const t  = useTranslations('nav');
  const tb = useTranslations('beta');
  const locale   = useLocale();
  const pathname = usePathname();
  const router   = useRouter();

  const [scrolled,     setScrolled]     = useState(false);
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [betaVisible,  setBetaVisible]  = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const switchLocale = useCallback(() => {
    const next = locale === 'ar' ? 'en' : 'ar';
    const segs = pathname.split('/');
    if (segs[1] === 'ar' || segs[1] === 'en') segs[1] = next;
    else segs.splice(1, 0, next);
    router.push(segs.join('/') || '/');
  }, [locale, pathname, router]);

  const getHref = (href: string) => locale === 'ar' ? href : `/en${href}`;

  const isActive = (href: string) => {
    const base = locale === 'ar' ? '' : `/${locale}`;
    const full = base + href;
    return href === '/'
      ? pathname === full || pathname === `/${locale}`
      : pathname.startsWith(full);
  };

  return (
    <header className="fixed top-0 inset-x-0 z-[1000]">
      {/* Beta Banner */}
      {betaVisible && (
        <div className="beta-banner flex items-center justify-center gap-3">
          <span>{tb('banner')}</span>
          <button onClick={() => setBetaVisible(false)}
            className="opacity-60 hover:opacity-100 transition-opacity ms-2"
            aria-label="إغلاق">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Navbar */}
      <nav className={cn(
        'transition-all duration-300 border-b',
        scrolled
          ? 'navbar-blur border-black/[0.06] shadow-[0_1px_0_rgba(0,0,0,0.04)]'
          : 'bg-transparent border-transparent',
      )}>
        <div className="container">
          <div className="flex items-center justify-between h-[60px]">

            {/* Logo */}
            <Link href={getHref('/')} className="flex-shrink-0 flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A57A1]">
              <Image src="/logo.png" alt="إضمن EDMN" width={110} height={36} className="object-contain" priority />
              <span className="text-[11px] font-bold bg-[#1A57A1] text-white px-2 py-0.5 rounded-full">Beta</span>
            </Link>

            {/* Desktop Links */}
            <ul className="hidden lg:flex items-center gap-0.5">
              {navLinks.map(({ key, href }) => (
                <li key={key}>
                  <Link href={getHref(href)}
                    className={cn(
                      'px-3.5 py-2 rounded-xl text-[14px] font-medium transition-all duration-200',
                      isActive(href)
                        ? 'text-[#1A57A1] font-semibold'
                        : 'text-[#1d1d1f]/70 hover:text-[#1d1d1f]',
                    )}>
                    {t(key as any)}
                  </Link>
                </li>
              ))}
            </ul>

            {/* Right actions */}
            <div className="hidden lg:flex items-center gap-2">
              <button onClick={switchLocale}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[14px] font-medium text-[#1d1d1f]/60 hover:text-[#1d1d1f] transition-colors">
                <Globe size={15} />
                {t('switchLang')}
              </button>
              <Link href="#" className="btn btn-md btn-accent">
                <UserPlus size={15} />
                {t('register')}
              </Link>
            </div>

            {/* Mobile burger */}
            <button onClick={() => setMenuOpen(o => !o)}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-black/5 transition-colors"
              aria-label={menuOpen ? t('closeMenu') : t('openMenu')}
              aria-expanded={menuOpen}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div className={cn(
        'lg:hidden fixed inset-x-0 navbar-blur border-b border-black/[0.06] z-[999]',
        'transition-all duration-300',
        menuOpen ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2',
      )} style={{ top: betaVisible ? '98px' : '60px' }}>
        <div className="container py-5 flex flex-col gap-1">
          {navLinks.map(({ key, href }) => (
            <Link key={key} href={getHref(href)} onClick={closeMenu}
              className={cn(
                'px-4 py-3.5 rounded-2xl text-[16px] font-medium transition-all',
                isActive(href) ? 'bg-[#1A57A1]/8 text-[#1A57A1] font-semibold' : 'text-[#1d1d1f] hover:bg-black/4',
              )}>
              {t(key as any)}
            </Link>
          ))}
          <div className="pt-3 mt-1 border-t border-black/8 flex flex-col gap-2">
            <button onClick={() => { switchLocale(); closeMenu(); }}
              className="flex items-center gap-2 px-4 py-3 rounded-2xl text-[15px] font-medium text-[#1d1d1f]/70 hover:bg-black/4 transition-all">
              <Globe size={16} />{t('switchLang')}
            </button>
            <Link href="#" onClick={closeMenu} className="btn btn-lg btn-accent w-full justify-center">
              <UserPlus size={17} />{t('register')}
            </Link>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/20 z-[998]"
          style={{ top: betaVisible ? '98px' : '60px' }}
          onClick={closeMenu} aria-hidden="true" />
      )}
    </header>
  );
}
