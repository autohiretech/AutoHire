// AutoHire — ai-agent profile/settings tools. Mirrors updateProfile,
// setPaymentMethod/clearPaymentMethod, setPayoutMethod/clearPayoutMethod in
// web/src/lib/supabaseClient.ts.
//
// `set_currency` has no DB column to write to (display currency is client
// state, same as it was in ai-search's `set_currency` tool) — its `run()` is
// a pure action, like navigate/apply_filters. Notification preferences are
// NOT wired up: there's no `notification_prefs`-shaped column or table
// anywhere in this schema yet (checked packages/shared's NotificationKind /
// NotificationChannel — those describe a notification's own shape, not a
// per-user opt-in), so there's nothing this tool could actually persist. Left
// out rather than faked; see the report for the same note.

import type { ToolDef } from './types.ts';
import { mapRow, run } from './db.ts';

export const updateProfileTool: ToolDef<
  { fullName?: string; country?: string },
  unknown
> = {
  name: 'update_profile',
  description: "Update the signed-in user's own display name and/or account country.",
  input_schema: {
    type: 'object',
    properties: {
      fullName: { type: 'string' },
      country: { type: 'string', description: "ISO 3166-1 alpha-2, e.g. 'RW'." },
    },
  },
  scope: 'any',
  effect: 'write',
  summary: () => 'Updating your account',
  async run(ctx, input) {
    const patch: Record<string, unknown> = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.country !== undefined) patch.country = input.country.toUpperCase();
    const row = await run(ctx.supabase.from('profiles').update(patch).eq('id', ctx.userId).select('*').single());
    return mapRow(row);
  },
};

export const setPaymentMethodTool: ToolDef<
  { method: string; destinationMasked: string; label: string },
  unknown
> = {
  name: 'set_payment_method',
  description: "Save the renter's payment method summary (already-masked destination only, e.g. '••••4242').",
  input_schema: {
    type: 'object',
    properties: {
      method: { type: 'string' },
      destinationMasked: { type: 'string' },
      label: { type: 'string' },
    },
    required: ['method', 'destinationMasked', 'label'],
  },
  scope: 'any',
  effect: 'write',
  summary: () => 'Saving your payment method',
  async run(ctx, input) {
    const row = await run(
      ctx.supabase.from('profiles').update({
        payment_method: input.method,
        payment_destination: input.destinationMasked,
        payment_label: input.label,
        payment_status: 'pending',
      }).eq('id', ctx.userId).select('*').single(),
    );
    return mapRow(row);
  },
};

export const clearPaymentMethodTool: ToolDef<Record<string, never>, unknown> = {
  name: 'clear_payment_method',
  description: "Remove the renter's saved payment method.",
  input_schema: { type: 'object', properties: {} },
  scope: 'any',
  effect: 'write',
  summary: () => 'Clearing your payment method',
  async run(ctx) {
    const row = await run(
      ctx.supabase.from('profiles').update({
        payment_method: null,
        payment_destination: null,
        payment_label: null,
        payment_ref: null,
        payment_status: 'none',
      }).eq('id', ctx.userId).select('*').single(),
    );
    return mapRow(row);
  },
};

export const clearPayoutMethodTool: ToolDef<Record<string, never>, unknown> = {
  name: 'clear_payout_method',
  description: "Remove the host's connected payout method.",
  input_schema: { type: 'object', properties: {} },
  scope: 'host',
  effect: 'write',
  summary: () => 'Clearing your payout method',
  async run(ctx) {
    const row = await run(
      ctx.supabase.from('profiles').update({
        payout_method: null,
        payout_provider: null,
        payout_destination: null,
        payout_label: null,
        payout_status: 'none',
      }).eq('id', ctx.userId).select('*').single(),
    );
    return mapRow(row);
  },
};

export const setCurrencyTool: ToolDef<
  { currencyCode: string },
  { action: { type: 'toast'; message: string; currencyCode: string } }
> = {
  name: 'set_currency',
  description: 'Change which currency prices are displayed in.',
  input_schema: {
    type: 'object',
    properties: { currencyCode: { type: 'string', description: 'ISO 4217, e.g. USD, RWF, AED, CNY.' } },
    required: ['currencyCode'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Switching prices to ${input.currencyCode}`,
  run(_ctx, input) {
    // No DB column backs display currency (see the file comment) — this is a
    // client-state action only, same shape as ai-search's old `set_currency`
    // reply field. `type: 'toast'` is the closest fit in the SSE action enum
    // (navigate/filters/highlight/toast/confirm); the client reads
    // `currencyCode` off it to actually switch, and `message` if it just
    // wants something to show.
    return Promise.resolve({
      action: { type: 'toast', message: `Prices now shown in ${input.currencyCode}.`, currencyCode: input.currencyCode },
    });
  },
};

export const PROFILE_TOOLS: ToolDef[] = [
  updateProfileTool,
  setPaymentMethodTool,
  clearPaymentMethodTool,
  clearPayoutMethodTool,
  setCurrencyTool,
];
