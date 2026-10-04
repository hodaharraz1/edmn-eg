import { asc, eq } from 'drizzle-orm';
import { rolePermissionAction, staffUserAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { rolePermissions, roles, userRoles, users } from '@/server/db/schema';
import { ALL_PERMISSIONS, PERMISSIONS } from '@/server/rbac/permissions';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/ui/form';

export const metadata = { title: 'الأدوار والصلاحيات' };

export default async function Roles(props: PageProps<'/admin/roles'>) {
  const { actor, allowed } = await adminWith('roles.manage');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'staff');
  const roleList = await db.select().from(roles).orderBy(asc(roles.code));
  const rp = await db.select().from(rolePermissions);
  const staff = await db.select().from(users).where(eq(users.isStaff, true)).orderBy(asc(users.createdAt));
  const ur = await db.select().from(userRoles);
  return (
    <div className="space-y-4">
      <PageHeader title="الأدوار والصلاحيات" description="يُتحقق من الصلاحيات على الخادم في كل إجراء؛ إخفاء عناصر القائمة ليس وسيلة الحماية. كل تغيير يُسجّل في سجل التدقيق." />
      <Tabs active={tab} tabs={[{ key: 'staff', label: 'فريق العمل', href: '/admin/roles' }, { key: 'matrix', label: 'مصفوفة الصلاحيات', href: '/admin/roles?tab=matrix' }]} />
      {tab === 'staff' && (
        <>
          <ul className="space-y-2">
            {staff.map((u) => {
              const mine = ur.filter((x) => x.userId === u.id).map((x) => x.roleCode);
              return (
                <li key={u.id} className="card space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><b>{u.fullName}</b> <span className="ltr text-xs text-muted">{u.email}</span> · آخر دخول {formatDate(u.lastLoginAt, true)} {u.totpEnabledAt ? <Badge tone="success">2FA</Badge> : <Badge tone="warning">بدون 2FA</Badge>}</span>
                    <span className="flex flex-wrap gap-1">{mine.map((r) => <Badge key={r} tone="brand">{roleList.find((x) => x.code === r)?.nameAr ?? r}</Badge>)}<StatusChip status={u.status} /></span>
                  </div>
                  {u.id !== actor.userId && (
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={staffUserAction} className="flex gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <Select name="role" className="w-auto" aria-label="الدور">{roleList.map((r) => <option key={r.code} value={r.code}>{r.nameAr}</option>)}</Select>
                        <SubmitButton size="sm" variant="outline" name="op" value="grant">منح</SubmitButton>
                        <SubmitButton size="sm" variant="ghost" name="op" value="revoke">سحب</SubmitButton>
                      </ActionForm>
                      <ActionForm action={staffUserAction}>
                        <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="op" value="disable" /><input type="hidden" name="status" value={u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'} />
                        <SubmitButton size="sm" variant={u.status === 'ACTIVE' ? 'danger' : 'outline'}>{u.status === 'ACTIVE' ? 'تعطيل الحساب' : 'إعادة التفعيل'}</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <ActionForm action={staffUserAction} className="card grid gap-3 p-5 md:grid-cols-2" resetOnSuccess>
            <input type="hidden" name="op" value="create" />
            <h2 className="font-bold md:col-span-2">إضافة موظف</h2>
            <Field label="الاسم" required><Input name="fullName" required /></Field>
            <Field label="البريد" required><Input name="email" type="email" required className="ltr" /></Field>
            <Field label="الموبايل" required><Input name="phone" required className="ltr" /></Field>
            <Field label="كلمة مرور مؤقتة" required hint="12 حرفاً على الأقل مع أرقام ورموز؛ سيُطلب منه تفعيل 2FA عند أول دخول."><Input name="password" type="password" required minLength={12} autoComplete="new-password" /></Field>
            <Field label="الدور" required><Select name="role">{roleList.map((r) => <option key={r.code} value={r.code}>{r.nameAr}</option>)}</Select></Field>
            <div className="md:col-span-2"><SubmitButton>إضافة</SubmitButton></div>
          </ActionForm>
        </>
      )}
      {tab === 'matrix' && (
        <>
          <Alert tone="warning">صلاحيات «المدير العام» ثابتة ولا يمكن تعديلها. احرص على مبدأ أقل صلاحية والفصل بين المعتمد والمنفذ في العمليات المالية.</Alert>
          {roleList.map((r) => {
            const has = new Set(rp.filter((x) => x.roleCode === r.code).map((x) => x.permission));
            return (
              <details key={r.code} className="card p-4">
                <summary className="cursor-pointer"><b>{r.nameAr}</b> <span className="ltr text-xs text-muted">{r.code}</span> · {has.size} صلاحية</summary>
                {r.code === 'SUPER_ADMIN' ? <p className="mt-2 text-sm text-muted">كل الصلاحيات.</p> : (
                  <ActionForm action={rolePermissionAction} className="mt-3 space-y-3">
                    <input type="hidden" name="role" value={r.code} />
                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{ALL_PERMISSIONS.map((p) => <Checkbox key={p} name="perm" value={p} defaultChecked={has.has(p)} label={<span>{PERMISSIONS[p]} <span className="ltr text-[10px] text-muted">{p}</span></span>} />)}</div>
                    <div className="flex gap-2"><Input name="reason" required minLength={3} placeholder="سبب التعديل" className="w-72" aria-label="السبب" /><SubmitButton size="sm">حفظ</SubmitButton></div>
                  </ActionForm>
                )}
              </details>
            );
          })}
        </>
      )}
    </div>
  );
}
