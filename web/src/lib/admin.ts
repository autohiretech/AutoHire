import type { DisputeStatus, ModerationStatus } from '@autohire/shared';

type BadgeTone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const MODERATION_STATUS_META: Record<ModerationStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  removed: { label: 'Removed', tone: 'danger' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export const DISPUTE_STATUS_META: Record<DisputeStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  under_review: { label: 'Under review', tone: 'accent' },
  resolved_renter: { label: 'Resolved — renter', tone: 'success' },
  resolved_host: { label: 'Resolved — host', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export const FLAG_REASON_LABEL: Record<string, string> = {
  inappropriate: 'Inappropriate',
  spam: 'Spam',
  fraud: 'Fraud',
  safety: 'Safety',
  other: 'Other',
};
