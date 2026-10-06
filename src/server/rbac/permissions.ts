/**
 * Permission catalogue. Enforcement is ALWAYS server-side (`requirePermission`) — hiding a button
 * in the UI is never treated as authorization.
 */
export const PERMISSIONS = {
  // Dashboard & reporting
  'dashboard.view': 'عرض لوحة القيادة',
  'reports.view': 'عرض التقارير',
  'reports.export': 'تصدير البيانات',
  // Customers
  'customers.view': 'عرض العملاء',
  'customers.manage': 'إدارة حسابات العملاء',
  // Sellers
  'sellers.view': 'عرض البائعين',
  'sellers.review': 'مراجعة طلبات البائعين',
  'sellers.suspend': 'إيقاف وتقييد البائعين',
  'sellers.documents.view': 'عرض وثائق الهوية',
  'sellers.payout.verify': 'اعتماد بيانات السحب',
  // Catalog
  'catalog.manage': 'إدارة التصنيفات والعلامات والسمات',
  'products.view': 'عرض المنتجات',
  'products.moderate': 'مراجعة المنتجات',
  'policy.manage': 'إدارة سياسات المنتجات المحظورة',
  // Orders & fulfilment
  'orders.view': 'عرض الطلبات',
  'orders.manage': 'إدارة الطلبات',
  'orders.confirm_receipt_on_behalf': 'تأكيد الاستلام نيابة عن العميل',
  'shipping.view': 'عرض مستندات الشحن',
  // Payments
  'payments.view': 'عرض المدفوعات',
  'payments.verify': 'تأكيد/رفض المدفوعات',
  'payments.destinations.manage': 'إدارة حسابات الاستلام',
  // Returns, refunds, disputes
  'returns.manage': 'إدارة المرتجعات',
  'refunds.pay': 'تسجيل صرف المبالغ المستردة',
  'disputes.manage': 'إدارة النزاعات',
  'deals.view': 'عرض الصفقات الخارجية',
  'deals.manage': 'إدارة الصفقات الخارجية',
  'deals.payout': 'صرف مستحقات الصفقات',
  // Reviews
  'reviews.moderate': 'إدارة التقييمات',
  // Finance
  'finance.view': 'عرض الحسابات المالية',
  'commissions.manage': 'إدارة العمولات',
  'withdrawals.view': 'عرض طلبات السحب',
  'withdrawals.approve': 'اعتماد طلبات السحب (المراجِع)',
  'withdrawals.pay': 'تنفيذ وتسجيل صرف السحب (المنفّذ)',
  'ledger.adjust.create': 'إنشاء تسوية مالية',
  'ledger.adjust.approve': 'اعتماد تسوية مالية',
  'settlements.manage': 'إدارة التسويات الدورية',
  // Ops
  'support.manage': 'إدارة الدعم الفني',
  // Buyer ↔ seller conversations (private customer communication — every staff view is audited)
  'messages.view': 'عرض محادثات المشترين والبائعين',
  'messages.moderate': 'إدارة البلاغات وإخفاء الرسائل',
  'cms.manage': 'إدارة المحتوى',
  'legal.manage': 'إدارة النصوص القانونية',
  'notifications.manage': 'إدارة قوالب الإشعارات',
  'audit.view': 'عرض سجل التدقيق',
  'roles.manage': 'إدارة الأدوار والصلاحيات',
  'settings.manage': 'إدارة إعدادات النظام',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Default staff roles (seeded; editable by SUPER_ADMIN through Roles & Permissions). */
export const DEFAULT_ROLES: Record<string, { nameAr: string; nameEn: string; permissions: Permission[] }> = {
  SUPER_ADMIN: { nameAr: 'مدير عام النظام', nameEn: 'Super admin', permissions: ALL_PERMISSIONS },
  OPERATIONS_MANAGER: {
    nameAr: 'مدير العمليات',
    nameEn: 'Operations manager',
    permissions: [
      'dashboard.view', 'reports.view', 'reports.export', 'customers.view', 'sellers.view', 'sellers.review',
      'sellers.suspend', 'products.view', 'products.moderate', 'orders.view', 'orders.manage', 'shipping.view',
      'orders.confirm_receipt_on_behalf', 'payments.view', 'returns.manage', 'disputes.manage', 'deals.view',
      'deals.manage', 'reviews.moderate', 'support.manage', 'cms.manage', 'audit.view', 'finance.view',
      'withdrawals.view', 'messages.view', 'messages.moderate',
    ],
  },
  SELLER_REVIEWER: {
    nameAr: 'مراجع البائعين',
    nameEn: 'Seller reviewer',
    permissions: ['dashboard.view', 'sellers.view', 'sellers.review', 'sellers.documents.view', 'sellers.payout.verify'],
  },
  CATALOG_REVIEWER: {
    nameAr: 'مراجع المنتجات',
    nameEn: 'Catalog reviewer',
    permissions: ['dashboard.view', 'products.view', 'products.moderate', 'catalog.manage', 'policy.manage', 'sellers.view'],
  },
  PAYMENT_REVIEWER: {
    nameAr: 'مراجع المدفوعات',
    nameEn: 'Payment reviewer',
    permissions: ['dashboard.view', 'payments.view', 'payments.verify', 'orders.view', 'deals.view'],
  },
  FINANCE_OPERATOR: {
    nameAr: 'منفّذ مالي',
    nameEn: 'Finance operator',
    permissions: [
      'dashboard.view', 'finance.view', 'withdrawals.view', 'withdrawals.pay', 'refunds.pay', 'deals.payout',
      'ledger.adjust.create', 'payments.view', 'orders.view', 'settlements.manage', 'reports.view', 'reports.export',
    ],
  },
  FINANCE_CHECKER: {
    nameAr: 'مراجع مالي (معتمد)',
    nameEn: 'Finance checker',
    permissions: [
      'dashboard.view', 'finance.view', 'withdrawals.view', 'withdrawals.approve', 'ledger.adjust.approve',
      'commissions.manage', 'payments.destinations.manage', 'payments.view', 'orders.view', 'reports.view',
    ],
  },
  DISPUTE_OFFICER: {
    nameAr: 'مسؤول النزاعات',
    nameEn: 'Dispute officer',
    permissions: ['dashboard.view', 'disputes.manage', 'returns.manage', 'orders.view', 'shipping.view', 'deals.view', 'deals.manage', 'payments.view', 'messages.view'],
  },
  CUSTOMER_SUPPORT: {
    nameAr: 'خدمة العملاء',
    nameEn: 'Customer support',
    permissions: ['dashboard.view', 'support.manage', 'customers.view', 'orders.view', 'sellers.view', 'deals.view', 'reviews.moderate', 'messages.view', 'messages.moderate'],
  },
};

/** Seller-staff permissions inside the Seller Center (scoped to their own seller account). */
export const SELLER_PERMISSIONS = [
  'store.manage',
  'products.manage',
  'inventory.manage',
  'orders.manage',
  /** Read and answer buyer conversations on the store's orders (not granted to finance/catalog staff). */
  'orders.communicate',
  'returns.manage',
  'finance.view',
  'finance.withdraw',
  'payout.manage',
  'reviews.respond',
  'support.use',
  'staff.manage',
] as const;
export type SellerPermission = (typeof SELLER_PERMISSIONS)[number];

export const SELLER_ROLE_PERMISSIONS: Record<string, readonly SellerPermission[]> = {
  STORE_OWNER: SELLER_PERMISSIONS,
  STORE_MANAGER: ['store.manage', 'products.manage', 'inventory.manage', 'orders.manage', 'orders.communicate', 'returns.manage', 'reviews.respond', 'support.use', 'finance.view'],
  CATALOG_MANAGER: ['products.manage', 'inventory.manage', 'support.use'],
  ORDER_MANAGER: ['orders.manage', 'orders.communicate', 'returns.manage', 'inventory.manage', 'support.use'],
  FINANCE: ['finance.view', 'finance.withdraw', 'support.use'],
  SUPPORT: ['support.use', 'reviews.respond', 'orders.manage', 'orders.communicate'],
};
