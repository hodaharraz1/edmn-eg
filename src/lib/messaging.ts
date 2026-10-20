/** Client-safe messaging types and labels (no server imports). */
export type MessageReportReason = 'INAPPROPRIATE' | 'FRAUD_ATTEMPT' | 'UNNEEDED_DATA_REQUEST' | 'OTHER';

export const REPORT_REASON_LABELS: Record<MessageReportReason, string> = {
  INAPPROPRIATE: 'محتوى غير مناسب',
  FRAUD_ATTEMPT: 'محاولة احتيال',
  UNNEEDED_DATA_REQUEST: 'طلب بيانات مش مطلوبة',
  OTHER: 'مشكلة تانية',
};

export type Side = 'BUYER' | 'SELLER';

/** A message as sent to the browser (dates as ISO strings). */
export interface MessageDTO {
  id: string;
  side: Side;
  mine: boolean;
  body: string;
  createdAt: string;
  hidden: boolean;
  hiddenReason: string | null;
  originalBody?: string;
  attachments: { fileId: string; mimeType: string; name: string | null }[];
  readByOther: boolean;
  reportCount?: number;
  /** client-only: optimistic message waiting for the server */
  pending?: 'sending' | 'failed';
}

export interface IncomingAlert {
  id: string;
  conversationId: string;
  href: string;
  ref: string;
  from: string;
  preview: string;
  attachment: boolean;
  createdAt: string;
}
