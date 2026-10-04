import type { Metadata } from 'next';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { db } from '@/server/db/client';
import { categoryTree } from '@/server/modules/catalog/taxonomy';
import { Breadcrumbs, PageHeader } from '@/ui/data';

export const metadata: Metadata = { title: 'كل التصنيفات', alternates: { canonical: '/categories' } };

export default async function CategoriesPage() {
  const tree = await categoryTree(db, { activeOnly: true });
  return (
    <div className="container-page py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'التصنيفات' }]} />} title="كل التصنيفات" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tree.filter((c) => !c.isProhibited).map((c) => {
          const Icon = ((c.icon && (Icons as unknown as Record<string, LucideIcon>)[c.icon]) || Icons.Tag) as LucideIcon;
          return (
            <section key={c.id} className="card p-4">
              <Link href={`/category/${c.slug}`} className="flex items-center gap-3 font-bold hover:text-brand-700">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon className="size-6" aria-hidden />
                </span>
                {c.nameAr}
              </Link>
              {c.children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {c.children.map((ch) => (
                    <li key={ch.id}>
                      <Link href={`/category/${ch.slug}`} className="block rounded-full bg-page px-3 py-1 text-sm hover:bg-brand-50 hover:text-brand-700">
                        {ch.nameAr}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
