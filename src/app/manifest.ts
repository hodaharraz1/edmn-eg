import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'إضمن EDMN — وساطة مالية آمنة',
    short_name: 'إضمن',
    description: 'تطبيق الوساطة المالية الآمنة في مصر — حماية كاملة للمشتري والبائع',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F3F3',
    theme_color: '#1A57A1',
    orientation: 'portrait',
    scope: '/',
    lang: 'ar',
    dir: 'rtl',
    icons: [
      { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
      { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
      { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    categories: ['finance', 'business', 'utilities'],
    screenshots: [
      {
        src: '/screenshots/home.png',
        sizes: '390x844',
        type: 'image/png',
        label: 'الصفحة الرئيسية',
      },
    ],
    shortcuts: [
      {
        name: 'تسجيل الدخول',
        url: '/login',
        description: 'تسجيل الدخول لحسابك',
        icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
      },
    ],
  };
}
