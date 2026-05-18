import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/utils';
import SectionTag from '@/components/ui/SectionTag';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | إضمن EDMN',
  description: 'سياسة الخصوصية وحماية البيانات لتطبيق إضمن EDMN للوساطة المالية',
};

const sections = [
  {
    title: '1. المعلومات التي نجمعها',
    content: `نجمع المعلومات التالية عند استخدامك لخدماتنا:
• البيانات الشخصية: الاسم، البريد الإلكتروني، رقم الهاتف
• بيانات المعاملات: تفاصيل الصفقات والمدفوعات
• البيانات التقنية: عنوان IP، نوع المتصفح، الجهاز
• بيانات الاستخدام: كيفية استخدامك للتطبيق والموقع`,
  },
  {
    title: '2. كيف نستخدم معلوماتك',
    content: `نستخدم بياناتك من أجل:
• تقديم خدمات الوساطة المالية وإتمام المعاملات
• التحقق من هوية المستخدمين ومنع الاحتيال
• تحسين خدماتنا وتجربة المستخدم
• التواصل معك بشأن حسابك والمعاملات
• الامتثال للمتطلبات القانونية والتنظيمية`,
  },
  {
    title: '3. حماية البيانات',
    content: `نلتزم بأعلى معايير حماية البيانات:
• تشفير SSL/TLS لجميع الاتصالات
• تشفير AES-256 لبيانات المدفوعات
• اختبارات أمنية دورية
• صلاحيات وصول محدودة للموظفين
• امتثال للمتطلبات التنظيمية المصرية`,
  },
  {
    title: '4. مشاركة البيانات',
    content: `لا نبيع بياناتك الشخصية. نشاركها فقط مع:
• الشركاء الماليين (بنك مصر، فوري، ValU) لإتمام المعاملات
• مزودي الخدمات التقنية المعتمدين
• الجهات القانونية والتنظيمية عند الطلب
• في حالة الاندماج أو الاستحواذ`,
  },
  {
    title: '5. حقوقك',
    content: `لديك الحق في:
• الوصول إلى بياناتك الشخصية
• تصحيح البيانات غير الدقيقة
• طلب حذف بياناتك
• الاعتراض على معالجة بياناتك
• نقل بياناتك لمزود آخر
لممارسة حقوقك، تواصل معنا على: info@edmneg.com`,
  },
  {
    title: '6. ملفات تعريف الارتباط (Cookies)',
    content: `نستخدم ملفات تعريف الارتباط لـ:
• تحسين تجربة الموقع وحفظ تفضيلاتك
• تحليل استخدام الموقع عبر Google Analytics
• ضمان الأمان ومنع الاحتيال
يمكنك التحكم في الكوكيز من إعدادات متصفحك.`,
  },
  {
    title: '7. AML/KYC والامتثال المالي',
    content: `بصفتنا منصة مالية، نلتزم بـ:
• متطلبات مكافحة غسيل الأموال (AML)
• سياسات اعرف عميلك (KYC)
• اللوائح المالية المصرية
قد يُطلب منك تقديم وثائق للتحقق من الهوية.`,
  },
  {
    title: '8. الاحتفاظ بالبيانات',
    content: `نحتفظ بالبيانات لمدة:
• بيانات الحساب: طوال فترة نشاط الحساب
• سجلات المعاملات: 7 سنوات (متطلبات قانونية)
• بيانات الجلسة: 30 يوماً
بعد انتهاء فترة الاحتفاظ، يتم حذف البيانات بشكل آمن.`,
  },
];

export default function PrivacyPolicyPage() {
  return (
    <>
      {/* Hero */}
      <section className="pt-32 pb-12 bg-gradient-to-br from-[#EBF2FC] to-white">
        <div className="container max-w-3xl">
          <SectionTag>قانوني</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-3">سياسة الخصوصية</h1>
          <p className="text-[#4B5563] text-base">
            آخر تحديث: يناير 2025 | تسري على: شركة إضمن إي جي ش.ذ.م.م
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="section-padding bg-white">
        <div className="container max-w-3xl">
          <p className="text-[#4B5563] leading-relaxed mb-10 bg-[#EBF2FC] rounded-2xl p-6 border border-[#1A57A1]/20">
            إضمن إي جي ("إضمن"، "نحن") تلتزم بحماية خصوصيتك. توضح هذه السياسة كيفية جمع معلوماتك واستخدامها وحمايتها عند استخدامك لخدماتنا.
          </p>

          <div className="flex flex-col gap-8">
            {sections.map(({ title, content }) => (
              <div key={title} className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl p-6">
                <h2 className="text-[#1A57A1] text-xl mb-4">{title}</h2>
                <div className="text-[#4B5563] leading-relaxed whitespace-pre-line text-sm">
                  {content}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 bg-[#1F2937] rounded-2xl p-6 text-white">
            <h3 className="font-bold text-amber-300 mb-3">تواصل معنا</h3>
            <p className="text-gray-300 text-sm">
              لأي استفسار بشأن سياسة الخصوصية، تواصل معنا:
            </p>
            <p className="text-white font-bold mt-2">info@edmneg.com</p>
            <p className="text-gray-400 text-sm mt-1">الإسكندرية، مصر — سجل تجاري: 24374</p>
          </div>
        </div>
      </section>
    </>
  );
}
