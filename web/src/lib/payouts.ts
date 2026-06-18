import type { PayoutChannel, PayoutStatus } from '@autohire/shared';

type BadgeTone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** Human label for each payout rail (Rwanda split-payout channels). */
export const PAYOUT_CHANNEL_LABEL: Record<PayoutChannel, string> = {
  mtn_momo: 'MTN MoMo',
  airtel_money: 'Airtel Money',
  bank_transfer: 'Bank transfer',
};

export const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; tone: BadgeTone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};
