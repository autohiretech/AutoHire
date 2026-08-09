-- AutoHire migration 050 — every rail PayHold can actually pay, as a method.
--
-- `payout_method` allowed exactly three values: momo, bank, card. PayHold
-- tokenizes against eight rails (`PayoutProvider` in _shared/payhold.ts), and
-- the five it had no name for here — PayPal, Venmo, Cash App, Alipay, WeChat
-- Pay — were unreachable: a host could not pick one, and this column could not
-- have stored it if they had.
--
-- The wallets are not a flavour of card. PayPal and Alipay take an address
-- rather than a number, PayHold routes them as their own providers, and folding
-- them into 'card' would have shown a host "Debit card ••••1234" for a PayPal
-- account — which is what the seeding script had to do before this migration,
-- and why it is being widened rather than worked around.
--
-- Renter-side `payment_method` gets the wallets that can COLLECT (PayPal,
-- Alipay, WeChat Pay). Venmo and Cash App are payout-only rails, so they are
-- deliberately absent there.
--
-- Existing rows are unaffected: this only widens what is permitted. Nothing is
-- removed from either check, so no current value can become invalid.
--
-- Apply after migration 049. Safe to re-run.

-- ----------------------------------------------------------------------------
-- Host payout methods
-- ----------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_payout_method_check;
alter table profiles add constraint profiles_payout_method_check
  check (
    payout_method is null
    or payout_method in ('momo', 'bank', 'card', 'paypal', 'venmo', 'cash_app', 'alipay', 'wechat_pay')
  );

-- ----------------------------------------------------------------------------
-- Renter payment methods
-- ----------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_payment_method_check;
alter table profiles add constraint profiles_payment_method_check
  check (
    payment_method is null
    or payment_method in ('card', 'momo', 'bank', 'paypal', 'alipay', 'wechat_pay')
  );

comment on column profiles.payout_method is
  'Rail the host is paid on: momo, bank, card, paypal, venmo, cash_app, alipay, wechat_pay. Maps to a PayHold payout_provider.';
comment on column profiles.payment_method is
  'Rail the renter pays with: card, momo, bank, paypal, alipay, wechat_pay.';
