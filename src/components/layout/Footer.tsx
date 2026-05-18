import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Mail, Phone, MapPin } from 'lucide-react';

const FacebookIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);
const LinkedinIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
    <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
  </svg>
);

export default function Footer() {
  const t = useTranslations('footer');
  const tn = useTranslations('nav');
  const locale = useLocale();
  const year = new Date().getFullYear();
  const getHref = (href: string) => locale === 'ar' ? href : `/en${href}`;

  return (
    <footer className="bg-[#111827] text-white" role="contentinfo">
      <div className="container py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">

          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href={getHref('/')}
              className="inline-flex items-center gap-2 mb-4 rounded-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none">
              <span className="text-white font-extrabold text-2xl">إضمن</span>
              <span className="text-[#F0171A] font-bold text-2xl">EDMN</span>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-[260px]">
              {t('desc')}
            </p>
            <div className="flex gap-2.5">
              {[
                { icon: <FacebookIcon />, href: 'https://www.facebook.com/share/1Ebp9L869e/', label: t('facebook') },
                { icon: <LinkedinIcon />, href: 'https://www.linkedin.com/company/edmneg/', label: t('linkedin') },
              ].map(({ icon, href, label }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                   aria-label={label}
                   className="w-8 h-8 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center
                              text-gray-400 hover:bg-[#1A57A1] hover:text-white hover:border-[#1A57A1]
                              transition-all duration-200">
                  {icon}
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h5 className="font-bold text-white mb-4 text-sm uppercase tracking-wider">{t('quickLinks')}</h5>
            <nav className="flex flex-col gap-2.5" aria-label={locale === 'ar' ? 'روابط سريعة' : 'Quick links'}>
              {[
                { label: tn('home'), href: '/' },
                { label: tn('about'), href: '/about' },
                { label: tn('whyUs'), href: '/why-us' },
                { label: tn('howItWorks'), href: '/how-it-works' },
                { label: tn('faq'), href: '/faq' },
                { label: tn('blog'), href: '/blog' },
              ].map(({ label, href }) => (
                <Link key={href} href={getHref(href)}
                  className="text-gray-400 hover:text-white text-sm transition-colors hover:translate-x-0.5 rtl:hover:-translate-x-0.5 inline-flex">
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Legal */}
          <div>
            <h5 className="font-bold text-white mb-4 text-sm uppercase tracking-wider">{t('legal')}</h5>
            <nav className="flex flex-col gap-2.5">
              {[
                { label: t('privacy'), href: '/privacy-policy' },
                { label: t('terms'), href: '/terms' },
                { label: t('refund'), href: '/refund-policy' },
              ].map(({ label, href }) => (
                <Link key={href} href={getHref(href)}
                  className="text-gray-400 hover:text-white text-sm transition-colors inline-flex">
                  {label}
                </Link>
              ))}
            </nav>
            <div className="mt-5 pt-4 border-t border-white/8">
              <p className="text-xs text-gray-500">{t('cr')}</p>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h5 className="font-bold text-white mb-4 text-sm uppercase tracking-wider">{t('contactUs')}</h5>
            <div className="flex flex-col gap-3.5">
              {[
                { icon: <Phone size={14} className="text-[#1A57A1] flex-shrink-0 mt-0.5" />, text: '+20 111 234 5661', href: 'tel:+201112345661' },
                { icon: <Mail size={14} className="text-[#1A57A1] flex-shrink-0 mt-0.5" />, text: 'info@edmneg.com', href: 'mailto:info@edmneg.com' },
                { icon: <MapPin size={14} className="text-[#1A57A1] flex-shrink-0 mt-0.5" />, text: 'الإسكندرية، مصر', href: null },
              ].map(({ icon, text, href }, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  {icon}
                  {href ? (
                    <a href={href} className="text-gray-400 hover:text-white text-sm transition-colors">{text}</a>
                  ) : (
                    <span className="text-gray-400 text-sm">{text}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/8">
        <div className="container py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-gray-500 text-xs">
            {t('copyright', { year })}
          </p>
          <div className="flex items-center gap-5">
            {[
              { label: t('privacy'), href: '/privacy-policy' },
              { label: t('terms'), href: '/terms' },
            ].map(({ label, href }) => (
              <Link key={href} href={getHref(href)}
                className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
