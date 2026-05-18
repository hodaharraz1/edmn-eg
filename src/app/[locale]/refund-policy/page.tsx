import type { Metadata } from 'next';
import SectionTag from '@/components/ui/SectionTag';

export const metadata: Metadata = {
  title: 'سياسة الاسترداد | إضمن EDMN',
  description: 'سياسة استرداد الأموال لتطبيق إضمن EDMN للوساطة المالية',
};

export default function RefundPolicyPage() {
  const cases = [
    { case: 'عدم استلام المنتج', timeframe: '5-7 أيام عمل', guarantee: '100%' },
    { case: 'منتج مختلف عن المتفق', timeframe: '7-10 أيام عمل', guarantee: '100%' },
    { case: 'إثبات الاحتيال', timeframe: '3-5 أيام عمل', guarantee: '100%' },
    { case: 'عيب جوهري في المنتج', timeframe: '10-14 يوم عمل', guarantee: 'جزئي أو كامل' },
  ];

  return (
    <>
      <section style={{ paddingTop: "100px", paddingBottom: "48px", background: "linear-gradient(180deg,#f5f5f7 0%,#ffffff 100%)" }}>
        <div className="container max-w-3xl">
          <SectionTag>قانوني</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-3">سياسة الاسترداد</h1>
          <p className="text-[#4B5563]">آخر تحديث: يناير 2025</p>
        </div>
      </section>
      <section className="section-padding bg-white">
        <div className="container max-w-3xl">
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-8">
            <p className="font-bold text-green-700 mb-1">✅ ضمان استرداد كامل</p>
            <p className="text-green-600 text-sm">إضمن يضمن استرداد أموالك بالكامل في الحالات المؤهلة المذكورة أدناه.</p>
          </div>

          <h2 className="text-[#1A57A1] mb-6">حالات الاسترداد المؤهلة</h2>
          <div className="overflow-x-auto mb-8">
            <table className="w-full bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
              <thead>
                <tr className="bg-[#1A57A1] text-white text-sm">
                  <th className="py-3 px-5 text-start">الحالة</th>
                  <th className="py-3 px-5 text-center">مدة المعالجة</th>
                  <th className="py-3 px-5 text-center">نسبة الاسترداد</th>
                </tr>
              </thead>
              <tbody>
                {cases.map(({ case: c, timeframe, guarantee }, i) => (
                  <tr key={c} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'}>
                    <td className="py-3.5 px-5 text-[#1F2937] font-bold text-sm">{c}</td>
                    <td className="py-3.5 px-5 text-center text-[#4B5563] text-sm">{timeframe}</td>
                    <td className="py-3.5 px-5 text-center">
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">{guarantee}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-5">
            {[
              {
                title: 'خطوات طلب الاسترداد',
                content: '1. افتح التطبيق وانتقل إلى تفاصيل المعاملة\n2. اضغط على "طلب استرداد"\n3. اختر سبب الاسترداد وأرفق الأدلة\n4. سيتم مراجعة طلبك خلال 48 ساعة\n5. يُعالج الاسترداد المعتمد خلال 5-10 أيام عمل',
              },
              {
                title: 'حالات لا تستحق الاسترداد',
                content: '• تغيير رأيك بعد تأكيد استلام المنتج\n• المنتجات الرقمية التي تم تسليمها وتفعيلها\n• الخدمات التي تم تنفيذها بالكامل\n• الطلبات التي مضى عليها أكثر من 30 يوم من تأكيد الاستلام',
              },
            ].map(({ title, content }) => (
              <div key={title} className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl p-6">
                <h3 className="font-bold text-[#1F2937] mb-3 text-lg">{title}</h3>
                <p className="text-[#4B5563] text-sm whitespace-pre-line leading-relaxed">{content}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
