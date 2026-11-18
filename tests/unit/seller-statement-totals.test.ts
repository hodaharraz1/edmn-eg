import { expect, it, vi } from 'vitest';
import type { DbOrTx } from '@/server/db/client';
import { sellerStatement } from '@/server/modules/finance/seller-statement';

it('keeps lifetime sale, fee and refund totals when old sale rows fall outside the statement page', async () => {
  const base = { entry_id: 'sale', created_at: '2030-01-01', entry_type: 'ORDER_PAYMENT', source_type: 'seller_order', source_id: 'order', description: '',
    pending: '9000', available: '0', reserved: '0', so_ref: '100-A', so_merch: '10000', so_ship: '0', so_seller_fee: '1000', so_buyer_fee: '0', so_commission: '1000', so_source: 'ENGINE',
    refund_liability: null, wd_number: null, wd_cost: null, wd_actual_cost: null, wd_payer: null };
  const execute = vi.fn().mockResolvedValue({ rows: [base, ...Array.from({ length: 205 }, (_, i) => ({ ...base, entry_id: `release-${i}`, entry_type: 'SELLER_RELEASE', pending: '0', available: '0' }))] });
  const result = await sellerStatement('seller', 200, { execute } as unknown as Pick<DbOrTx, 'execute'>);
  expect(result.rows).toHaveLength(200);
  expect(result.rows.some((r) => r.entryId === 'sale')).toBe(false);
  expect(result.totals).toMatchObject({ grossSales: 10000, sellerFees: 1000, refunds: 0, pending: 9000 });
});
