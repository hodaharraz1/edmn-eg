'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import { Mail, Phone, MapPin } from 'lucide-react';

const FB = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>;
const LI = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V9h4v1.7A4 4 0 0 1 16 8zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>;

export default function Footer() {
  const t    = useTranslations('footer');
  const tn   = useTranslations('nav');
  const locale = useLocale();
  const year = new Date().getFullYear();
  const getHref = (h: string) => locale === 'ar' ? h : `/en${h}`;

  return (
    <footer style={{ background: '#1d1d1f', color: 'white' }}>
      <div className="container" style={{ padding: '64px 24px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '48px', marginBottom: '48px' }}>

          {/* Brand */}
          <div style={{ gridColumn: 'span 1' }}>
            <div style={{ marginBottom: '16px' }}>
              <Image src="/logo.png" alt="إضمن EDMN" width={110} height={36} style={{ objectFit: 'contain' }} />
            </div>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: '240px', marginBottom: '20px' }}>
              {t('desc')}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { Icon: FB, href: 'https://www.facebook.com/share/1Ebp9L869e/', label: t('facebook') },
                { Icon: LI, href: 'https://www.linkedin.com/company/edmneg/', label: t('linkedin') },
              ].map(({ Icon, href, label }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
                  style={{
                    width: '32px', height: '32px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'rgba(255,255,255,0.5)', transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1A57A1'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}>
                  <Icon />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h5 style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '20px' }}>{t('quickLinks')}</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[['home','/'],['whyUs','/why-us'],['howItWorks','/how-it-works'],['faq','/faq'],['blog','/blog']].map(([key, href]) => (
                <Link key={href} href={getHref(href)}
                  style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'white')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}>
                  {tn(key as any)}
                </Link>
              ))}
            </div>
          </div>

          {/* Legal */}
          <div>
            <h5 style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '20px' }}>{t('legal')}</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[[t('privacy'),'/privacy-policy'],[t('terms'),'/terms'],[t('refund'),'/refund-policy']].map(([label, href]) => (
                <Link key={href} href={getHref(href)}
                  style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'white')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}>
                  {label}
                </Link>
              ))}
            </div>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', marginTop: '20px' }}>{t('cr')}</p>
          </div>

          {/* Contact */}
          <div>
            <h5 style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '20px' }}>{t('contactUs')}</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { Icon: Phone, text: '+20 111 234 5661', href: 'tel:+201112345661' },
                { Icon: Mail,  text: 'info@edmneg.com',  href: 'mailto:info@edmneg.com' },
                { Icon: MapPin,text: 'الإسكندرية، مصر',  href: null },
              ].map(({ Icon, text, href }, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon size={13} color="rgba(255,255,255,0.3)" />
                  {href
                    ? <a href={href} style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', transition: 'color 0.2s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'white')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}>{text}</a>
                    : <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>{text}</span>
                  }
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '24px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.25)' }}>
            {t('copyright', { year })}
          </p>
          <div style={{ display: 'flex', gap: '20px' }}>
            {[[t('privacy'),'/privacy-policy'],[t('terms'),'/terms']].map(([label, href]) => (
              <Link key={href} href={getHref(href)}
                style={{ fontSize: '13px', color: 'rgba(255,255,255,0.25)', transition: 'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
