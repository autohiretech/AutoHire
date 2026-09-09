/**
 * Brand identity and number detection for payout destinations.
 *
 * Two jobs, and the split between them is the important part:
 *
 *   **Looks** — a wallet or card brand rendered as something recognisable
 *   instead of a line in a dropdown. A host picking where their money goes
 *   should see the thing they hold in their hand.
 *
 *   **Detection** — reading the network or card scheme out of the number as
 *   it is typed, so the common case needs no choosing at all.
 *
 * **Detection never decides anything.** It pre-selects, and only ever from
 * the live list PayHold returned for that country
 * (`GET /v1/payment-options?payout_country=XX`). The repo rule is that a
 * client site never hardcodes a payment method, and this does not: a prefix
 * that resolves to a wallet PayHold did not offer is ignored, so a market
 * whose operators change is wrong here for exactly as long as it takes
 * PayHold to stop listing the old one — never longer. The host can always
 * override, and PayHold's `momoBankCode()` still refuses an unknown
 * (country, network) pair at the door.
 *
 * These are brand *indications* — a colour and a name — not reproductions of
 * anyone's logo. That is deliberate: it is what an acceptance mark needs to
 * do, and it avoids shipping trademarked artwork we have no licence to.
 */

/** A brand's visual identity. `fg` is chosen for contrast against `bg`. */
export interface Brand {
  label: string;
  bg: string;
  fg: string;
  /** A short form for the tile — "MTN", "VISA". Falls back to `label`. */
  short?: string;
}

/**
 * Mobile-money wallet brands, keyed by the **lowercased label PayHold uses**
 * — its `networks` array is the source of those strings, so these keys have
 * to match what it sends rather than what reads nicely here.
 *
 * A wallet absent from this map still renders, in neutral colours with its
 * own name. Missing branding is a cosmetic gap; refusing to show a wallet
 * PayHold says exists would be a functional one.
 */
export const WALLET_BRANDS: Record<string, Brand> = {
  mtn: { label: 'MTN MoMo', short: 'MTN', bg: '#FFCC00', fg: '#1a1a1a' },
  'mtn momo': { label: 'MTN MoMo', short: 'MTN', bg: '#FFCC00', fg: '#1a1a1a' },
  'airtel money': { label: 'Airtel Money', short: 'airtel', bg: '#E40000', fg: '#ffffff' },
  airtel: { label: 'Airtel Money', short: 'airtel', bg: '#E40000', fg: '#ffffff' },
  'm-pesa': { label: 'M-Pesa', short: 'M-PESA', bg: '#00A24B', fg: '#ffffff' },
  mpesa: { label: 'M-Pesa', short: 'M-PESA', bg: '#00A24B', fg: '#ffffff' },
  'tigo pesa': { label: 'Tigo Pesa', short: 'Tigo', bg: '#0033A0', fg: '#ffffff' },
  telecel: { label: 'Telecel', short: 'Telecel', bg: '#E4002B', fg: '#ffffff' },
  vodafone: { label: 'Vodafone', short: 'Vodafone', bg: '#E60000', fg: '#ffffff' },
  airteltigo: { label: 'AirtelTigo', short: 'AT', bg: '#E40000', fg: '#ffffff' },
  'orange money': { label: 'Orange Money', short: 'Orange', bg: '#FF7900', fg: '#1a1a1a' },
  wave: { label: 'Wave', short: 'Wave', bg: '#1DC3F3', fg: '#1a1a1a' },
  moov: { label: 'Moov', short: 'Moov', bg: '#0066B3', fg: '#ffffff' },
  zamtel: { label: 'Zamtel', short: 'Zamtel', bg: '#00A551', fg: '#ffffff' },
  halopesa: { label: 'HaloPesa', short: 'Halo', bg: '#F58220', fg: '#1a1a1a' },
};

export function walletBrand(network: string): Brand {
  return (
    WALLET_BRANDS[network.trim().toLowerCase()] ?? {
      label: network,
      short: network.slice(0, 6),
      bg: 'var(--color-surface-sunken)',
      fg: 'var(--color-content)',
    }
  );
}

export type CardScheme = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unionpay';

export const CARD_BRANDS: Record<CardScheme, Brand> = {
  visa: { label: 'Visa', short: 'VISA', bg: '#1A1F71', fg: '#ffffff' },
  mastercard: { label: 'Mastercard', short: 'MC', bg: '#1a1a1a', fg: '#ffffff' },
  amex: { label: 'American Express', short: 'AMEX', bg: '#006FCF', fg: '#ffffff' },
  discover: { label: 'Discover', short: 'DISC', bg: '#FF6000', fg: '#1a1a1a' },
  unionpay: { label: 'UnionPay', short: 'UP', bg: '#005BAC', fg: '#ffffff' },
};

/**
 * Which scheme a card number belongs to, from its IIN.
 *
 * Ranges are the published ones and are stable in a way operator prefixes are
 * not — Mastercard's 2221–2720 block is the only recent addition, and it is
 * included. Returns null while the number is still too short to tell, which
 * is most of the time somebody is typing: showing "Visa" after one digit and
 * changing your mind is worse than showing nothing for a moment.
 */
export function detectCardScheme(raw: string): CardScheme | null {
  const n = raw.replace(/\D/g, '');
  if (n.length < 2) return null;

  if (n.startsWith('4')) return 'visa';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(5[1-5])/.test(n)) return 'mastercard';
  if (n.length >= 4) {
    const four = Number(n.slice(0, 4));
    if (four >= 2221 && four <= 2720) return 'mastercard';
    if (n.startsWith('6011') || /^64[4-9]/.test(n) || n.startsWith('65')) return 'discover';
  }
  if (n.startsWith('62')) return 'unionpay';
  return null;
}

/**
 * Country → mobile prefix → the wallet that owns it.
 *
 * **Rwanda's entries are verified** against the national numbering plan and
 * the operators' own published ranges: 078 and 079 are MTN, 072 and 073 are
 * Airtel. 079 is worth calling out because it is the one that catches people
 * — it was unallocated in an older numbering plan and reads as "not MTN" to
 * anyone working from memory, which is exactly the kind of stale assumption
 * that mis-selects a real host's wallet.
 *
 * Only markets whose ranges have actually been checked belong here. An
 * unlisted country simply detects nothing and the host picks, which is the
 * correct outcome — a guess dressed up as a detection is worse than an
 * honest blank, because the host stops reading once a tile is lit.
 */
const MOMO_PREFIXES: Record<string, Record<string, string>> = {
  RW: { '78': 'MTN', '79': 'MTN', '72': 'Airtel Money', '73': 'Airtel Money' },
};

/**
 * The wallet a number belongs to, or null when we cannot tell.
 *
 * `offered` is PayHold's own list for the country and is a hard filter, not a
 * preference: a detection that is not on it is dropped. That is what keeps
 * this table from becoming a second, staler source of truth about which
 * wallets exist. Matching is case-insensitive and accepts either the label or
 * a leading word, so PayHold sending "Airtel" or "Airtel Money" both resolve.
 */
export function detectMomoNetwork(
  raw: string,
  country: string,
  offered: string[],
): string | null {
  const table = MOMO_PREFIXES[country.toUpperCase()];
  if (!table || offered.length === 0) return null;

  // Strip the country's dialling code and any trunk zero, so `+250 78…`,
  // `078…` and `78…` all reduce to the same two significant digits.
  let digits = raw.replace(/\D/g, '');
  if (country.toUpperCase() === 'RW' && digits.startsWith('250')) digits = digits.slice(3);
  digits = digits.replace(/^0+/, '');
  if (digits.length < 2) return null;

  const guess = table[digits.slice(0, 2)];
  if (!guess) return null;

  const want = guess.toLowerCase();
  return (
    offered.find((n) => n.toLowerCase() === want) ??
    offered.find((n) => n.toLowerCase().startsWith(want.split(' ')[0])) ??
    null
  );
}

/** A brand tile — the coloured chip that stands in for a logo. */
export function BrandMark({ brand, size = 'md' }: { brand: Brand; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      style={{ background: brand.bg, color: brand.fg }}
      className={
        size === 'sm'
          ? 'inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded px-1.5 text-[10px] font-bold tracking-tight'
          : 'inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-[var(--radius-control)] px-2 text-caption font-bold tracking-tight'
      }
    >
      {brand.short ?? brand.label}
    </span>
  );
}
