'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import SectionTag from '@/components/ui/SectionTag';
import { Phone, Mail, MapPin, Clock, Send, CheckCircle, AlertCircle } from 'lucide-react';

const schema = z.object({
  name: z.string().min(2, 'الاسم مطلوب'),
  email: z.string().email('بريد إلكتروني غير صحيح'),
  phone: z.string().optional(),
  subject: z.string().min(1, 'الموضوع مطلوب'),
  message: z.string().min(10, 'الرسالة يجب أن تكون 10 أحرف على الأقل'),
  // Honeypot anti-spam field
  website: z.string().max(0, 'spam'),
});

type FormData = z.infer<typeof schema>;

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function ContactForm() {
  const t = useTranslations('contact');
  const [status, setStatus] = useState<Status>('idle');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    // Honeypot check
    if (data.website) return;

    setStatus('loading');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Server error');
      setStatus('success');
      reset();
      setTimeout(() => setStatus('idle'), 5000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  const inputClass = (error?: string) =>
    `w-full px-4 py-3 bg-white border rounded-xl text-[#1F2937] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 transition-all text-sm ${
      error
        ? 'border-red-400 focus:ring-red-200'
        : 'border-[#E5E7EB] focus:ring-[#1A57A1]/30 focus:border-[#1A57A1]'
    }`;

  return (
    <>
      {/* Hero */}
      <section style={{ paddingTop: "100px", paddingBottom: "64px", background: "linear-gradient(180deg,#f5f5f7 0%,#ffffff 100%)" }}>
        <div className="container text-center">
          <SectionTag>{t('tag')}</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-4">{t('title')}</h1>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>
      </section>

      {/* Content */}
      <section className="section-padding bg-white">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

            {/* Info */}
            <div className="lg:col-span-1">
              <h3 className="font-bold text-[#1F2937] text-xl mb-6">{t('infoTitle')}</h3>
              <div className="flex flex-col gap-5 mb-8">
                {[
                  { icon: <Phone size={18} className="text-[#1A57A1]" />, text: '+20 111 234 5661', href: 'tel:+201112345661' },
                  { icon: <Mail size={18} className="text-[#1A57A1]" />, text: 'info@edmneg.com', href: 'mailto:info@edmneg.com' },
                  { icon: <MapPin size={18} className="text-[#1A57A1]" />, text: 'الإسكندرية، مصر', href: undefined },
                  { icon: <Clock size={18} className="text-[#1A57A1]" />, text: t('responseTime'), href: undefined },
                ].map(({ icon, text, href }, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-[#EBF2FC] rounded-lg flex items-center justify-center flex-shrink-0">
                      {icon}
                    </div>
                    {href ? (
                      <a href={href} className="text-[#4B5563] hover:text-[#1A57A1] transition-colors text-sm pt-1.5">
                        {text}
                      </a>
                    ) : (
                      <p className="text-[#4B5563] text-sm pt-1.5">{text}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Trust */}
              <div className="bg-[#EBF2FC] rounded-2xl p-5">
                <p className="font-bold text-[#1A57A1] mb-2 text-sm">🔒 بياناتك آمنة</p>
                <p className="text-[#4B5563] text-xs leading-relaxed">
                  نلتزم بحماية خصوصيتك وعدم مشاركة بياناتك مع أي طرف ثالث.
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-2">
              <AnimatePresence mode="wait">
                {status === 'success' ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex flex-col items-center justify-center text-center py-16 bg-green-50 rounded-2xl border border-green-200"
                  >
                    <CheckCircle size={56} className="text-green-500 mb-4" />
                    <h3 className="font-bold text-[#1F2937] text-2xl mb-2">{t('successTitle')}</h3>
                    <p className="text-[#4B5563]">{t('successDesc')}</p>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onSubmit={handleSubmit(onSubmit)}
                    noValidate
                    className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl p-8 flex flex-col gap-5"
                  >
                    {/* Honeypot — hidden from real users */}
                    <input {...register('website')} type="text" className="hidden" tabIndex={-1} autoComplete="off" />

                    {status === 'error' && (
                      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                        <AlertCircle size={18} />
                        <div>
                          <p className="font-bold text-sm">{t('errorTitle')}</p>
                          <p className="text-xs">{t('errorDesc')}</p>
                        </div>
                      </div>
                    )}

                    {/* Name + Email */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-bold text-[#1F2937] mb-1.5">
                          {t('nameLabel')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          {...register('name')}
                          type="text"
                          placeholder={t('namePlaceholder')}
                          autoComplete="name"
                          className={inputClass(errors.name?.message)}
                        />
                        {errors.name && (
                          <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-[#1F2937] mb-1.5">
                          {t('emailLabel')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          {...register('email')}
                          type="email"
                          placeholder={t('emailPlaceholder')}
                          autoComplete="email"
                          dir="ltr"
                          className={inputClass(errors.email?.message)}
                        />
                        {errors.email && (
                          <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Phone + Subject */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-bold text-[#1F2937] mb-1.5">
                          {t('phoneLabel')}
                        </label>
                        <input
                          {...register('phone')}
                          type="tel"
                          placeholder={t('phonePlaceholder')}
                          autoComplete="tel"
                          dir="ltr"
                          className={inputClass()}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-[#1F2937] mb-1.5">
                          {t('subjectLabel')} <span className="text-red-500">*</span>
                        </label>
                        <select
                          {...register('subject')}
                          className={inputClass(errors.subject?.message)}
                        >
                          <option value="">{t('subjectPlaceholder')}</option>
                          <option value="general">{t('subjectGeneral')}</option>
                          <option value="support">{t('subjectSupport')}</option>
                          <option value="business">{t('subjectBusiness')}</option>
                          <option value="complaint">{t('subjectComplaint')}</option>
                        </select>
                        {errors.subject && (
                          <p className="mt-1 text-xs text-red-500">{errors.subject.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Message */}
                    <div>
                      <label className="block text-sm font-bold text-[#1F2937] mb-1.5">
                        {t('messageLabel')} <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        {...register('message')}
                        rows={5}
                        placeholder={t('messagePlaceholder')}
                        className={`${inputClass(errors.message?.message)} resize-none`}
                      />
                      {errors.message && (
                        <p className="mt-1 text-xs text-red-500">{errors.message.message}</p>
                      )}
                    </div>

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={status === 'loading'}
                      className="flex items-center justify-center gap-2 w-full py-4 bg-[#1A57A1] text-white rounded-xl font-bold text-base hover:bg-[#164A8A] transition-all disabled:opacity-60 disabled:cursor-not-allowed hover:-translate-y-0.5 shadow-[0_4px_14px_rgba(26,87,161,.3)]"
                    >
                      {status === 'loading' ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          {t('submitting')}
                        </>
                      ) : (
                        <>
                          <Send size={18} />
                          {t('submit')}
                        </>
                      )}
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
