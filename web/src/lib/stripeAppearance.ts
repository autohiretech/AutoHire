import type { AppearanceOptions } from '@stripe/connect-js';

/**
 * AutoHire's design tokens, restated in the only vocabulary Stripe's embedded
 * components accept.
 *
 * Connect embedded components render inside Stripe's own iframe, and Stripe is
 * explicit that the `appearance` variables "are the only way to change styles
 * in Connect embedded components — you can't override their styles with CSS
 * selectors or other mechanisms". So none of `index.css` reaches them: without
 * this map the onboarding form renders in Stripe's default light theme, which
 * on a dark AutoHire is a white rectangle sitting inside a dark dialog, and in
 * light mode is a different grey, a different radius and a different blue from
 * everything around it.
 *
 * The values are *read* rather than copied. `getComputedStyle(:root)` answers
 * with whatever theme is live at that moment, so the dark palette needs no
 * second table here and a token edited in `index.css` moves Stripe's form with
 * it. A hardcoded hex would be a copy of somebody else's data, and would drift
 * the first time the palette changed.
 */

/**
 * The same stylesheet `index.html` loads. Stripe's iframe is a separate
 * document: naming Inter in `fontFamily` without giving it somewhere to fetch
 * Inter from leaves the form on the fallback system face, which is the one
 * visible difference a reviewer would still see after all the colours matched.
 */
const FONT_CSS_SRC =
  'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap';

/**
 * One custom property, resolved.
 *
 * `--color-accent-on` is defined as `var(--color-brand-600)` — a reference,
 * not a colour. Browsers substitute that at computed-value time, but the
 * failure mode if one does not is silent: Stripe is handed the literal string
 * `var(--color-brand-600)`, rejects it as a colour, and falls back to its own
 * blue with nothing logged. Following the chain ourselves costs one lookup.
 */
function token(styles: CSSStyleDeclaration, name: string, depth = 0): string {
  const raw = styles.getPropertyValue(name).trim();
  if (raw.startsWith('var(') && depth < 4) {
    const inner = raw.slice(4, raw.length - 1);
    const [ref, ...fallback] = inner.split(',');
    const resolved = token(styles, ref.trim(), depth + 1);
    return resolved || fallback.join(',').trim();
  }
  return raw;
}

/**
 * Drops the keys that resolved to nothing.
 *
 * Tailwind emits only the theme variables something in the app actually
 * references, so a token can be real in `index.css` and absent from the
 * stylesheet that ships. `getPropertyValue` answers `''` for those, and an
 * empty string handed to Stripe is not an error — it is ignored, silently, and
 * that colour quietly falls back to Stripe's blue with nothing to grep for.
 * Omitting the key produces the same fallback *visibly*: the value is missing
 * from the object, which is something a snapshot of this map can be read
 * against. `__stripe_theme_check` does exactly that.
 */
function compact<T extends Record<string, string | number | undefined>>(vars: T): T {
  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined && v !== ''),
  ) as T;
}

/**
 * Stripe takes pixels for every size — "supports pixel values only" — and our
 * radii are in `rem`. Converting against the real root font size rather than
 * assuming 16 keeps the form in step with a host who has scaled their browser
 * text up, which is exactly the host most likely to be squinting at it.
 */
function toPx(value: string, rootPx: number): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  if (value.endsWith('rem')) return `${Math.round(n * rootPx)}px`;
  if (value.endsWith('em')) return `${Math.round(n * rootPx)}px`;
  return `${Math.round(n)}px`;
}

/** Reads the live theme and returns it in Stripe's shape. */
export function stripeConnectAppearance(): AppearanceOptions {
  const root = document.documentElement;
  const s = getComputedStyle(root);
  const rootPx = Number.parseFloat(s.fontSize) || 16;
  const t = (name: string) => token(s, name);

  const accent = t('--color-accent-on');
  const control = toPx(t('--radius-control'), rootPx);
  // Asked of the stylesheet rather than of `prefers-color-scheme`: `index.css`
  // sets `color-scheme` on `:root` from both paths that decide the theme, so
  // this is also right on a screen that is dark by an explicit choice.
  const dark = s.colorScheme.trim() === 'dark';

  // The one pair that cannot be read straight from a semantic token. `Badge`
  // spells its brand tone as `bg-brand-50 text-brand-700` in light and
  // `bg-brand-900/40 text-brand-300` in dark — the ramp is fixed, and only the
  // component knows which end of it belongs to which theme. Reading brand-50
  // unconditionally is what a first version did, and it put a near-white mint
  // chip on a #171e1c form.
  const badgeSuccess = dark
    ? {
        background: t('--color-brand-900'),
        text: t('--color-brand-300'),
        border: t('--color-brand-700'),
      }
    : {
        background: t('--color-brand-50'),
        text: t('--color-brand-700'),
        border: t('--color-brand-200'),
      };

  return {
    // Stripe's own default. Named rather than left implicit because the other
    // choice — `drawer` — slides in from the edge of the *viewport*, which
    // inside a dialog that is already a sheet on mobile reads as two competing
    // panels rather than one form.
    overlays: 'dialog',
    variables: compact({
      fontFamily: t('--font-sans'),
      fontSizeBase: '16px',

      // Colours. `surface-overlay` is the dialog's own background — both
      // Stripe surfaces live inside a `Modal` — so the form sits on the same
      // plane as the dialog rather than as a darker card inside it. Reading
      // `raised` here instead would reintroduce the exact seam the overlay
      // token exists to remove, one layer in.
      colorPrimary: accent,
      colorBackground: t('--color-surface-overlay'),
      colorText: t('--color-content'),
      colorSecondaryText: t('--color-content-muted'),
      colorDanger: t('--color-danger-500'),
      colorBorder: t('--color-line-strong'),
      offsetBackgroundColor: t('--color-surface-sunken'),

      // Form fields, matched to `Input`: raised ground, strong line, accent on
      // focus, subtle placeholder.
      formBackgroundColor: t('--color-surface-overlay'),
      formHighlightColorBorder: accent,
      formAccentColor: accent,
      formPlaceholderTextColor: t('--color-content-subtle'),
      formBorderRadius: control,

      // Buttons, matched to `Button`. The accent already lightens itself in
      // dark mode through `--color-accent-on`, and `--color-accent-contrast`
      // is the text colour that stays legible on it in both.
      buttonPrimaryColorBackground: accent,
      buttonPrimaryColorBorder: accent,
      buttonPrimaryColorText: t('--color-accent-contrast'),
      buttonSecondaryColorBackground: t('--color-surface-sunken'),
      buttonSecondaryColorBorder: t('--color-line-strong'),
      buttonSecondaryColorText: t('--color-content'),
      buttonDangerColorBackground: t('--color-danger-500'),
      buttonDangerColorBorder: t('--color-danger-500'),
      buttonDangerColorText: '#ffffff',
      buttonBorderRadius: control,

      actionPrimaryColorText: accent,

      // Status badges, from the semantic pairs — saturated ink on its own
      // tint, which is what `Badge` and `Notice` already do.
      badgeNeutralColorBackground: t('--color-surface-sunken'),
      badgeNeutralColorText: t('--color-content-muted'),
      badgeNeutralColorBorder: t('--color-line-strong'),
      badgeSuccessColorBackground: badgeSuccess.background,
      badgeSuccessColorText: badgeSuccess.text,
      badgeSuccessColorBorder: badgeSuccess.border,
      badgeWarningColorBackground: t('--color-warn-tint'),
      badgeWarningColorText: t('--color-warn-500'),
      badgeWarningColorBorder: t('--color-warn-500'),
      badgeDangerColorBackground: t('--color-danger-tint'),
      badgeDangerColorText: t('--color-danger-500'),
      badgeDangerColorBorder: t('--color-danger-500'),

      // Headings at 600, not Stripe's 700. The type scale in `index.css` is
      // deliberate about this: 600 with tight spacing reads as serious, and a
      // 700 heading inside a 600 dialog is the kind of half-step that looks
      // like a mistake rather than a choice.
      headingXlFontWeight: '600',
      headingLgFontWeight: '600',
      headingMdFontWeight: '600',
      headingSmFontWeight: '600',
      headingXsFontWeight: '600',

      // Radii. `--radius-sheet` for overlays because a Stripe popover opening
      // over our dialog is the same kind of object our dialog is.
      borderRadius: control,
      overlayBorderRadius: toPx(t('--radius-sheet'), rootPx),

      // `Modal` portals itself at `z-50`, and Stripe's overlays are positioned
      // against the viewport, not against us. Without a number above ours, a
      // date picker or a confirmation opened *by the form inside the dialog*
      // renders behind the dialog — visible as a click that appears to do
      // nothing.
      overlayZIndex: 60,
      // The same wash `Modal` puts behind itself (`bg-black/50`), so a second
      // layer does not read as a different kind of dimming.
      overlayBackdropColor: 'rgba(0, 0, 0, 0.5)',
    }),
  };
}

/** The webfont sources Stripe should load inside its iframe. */
export const STRIPE_CONNECT_FONTS = [{ cssSrc: FONT_CSS_SRC }];

/**
 * The same tokens again, in the *other* vocabulary Stripe uses — the Elements
 * Appearance API that themes the Payment Element in checkout.
 *
 * Two APIs rather than one is Stripe's doing, not a duplication we chose:
 * Connect embedded components and Elements take different key names and
 * Elements alone has a `theme` to start from. What they share is this file, so
 * the card form a renter types into and the onboarding form a host fills in
 * cannot drift apart.
 *
 * The Element was previously themed with a hardcoded `#0f766e` — a teal that
 * belongs to no AutoHire token — and Stripe's light `stripe` theme, which put
 * a white card form inside a dark checkout dialog for every renter on a dark
 * phone.
 */
export function stripeElementsAppearance() {
  const s = getComputedStyle(document.documentElement);
  const rootPx = Number.parseFloat(s.fontSize) || 16;
  const t = (name: string) => token(s, name);
  const accent = t('--color-accent-on');
  const line = t('--color-line-strong');
  // Asked of the stylesheet, not of `prefers-color-scheme`. `index.css` sets
  // `color-scheme` on `:root` from both paths that decide the theme — the OS
  // preference and an explicit `data-theme` — so this stays right on a screen
  // that is dark for the second reason, where the media query alone says
  // light and would start the Element from the wrong base.
  const dark = s.colorScheme.trim() === 'dark';

  return {
    // `night` is Stripe's dark base. Starting from it and then correcting the
    // colours costs nothing and gets the details we do not name — shadows,
    // icon fills, the tab strip — right for the ground they sit on.
    theme: (dark ? 'night' : 'stripe') as 'night' | 'stripe',
    variables: compact({
      fontFamily: t('--font-sans'),
      fontSizeBase: '16px',
      borderRadius: toPx(t('--radius-control'), rootPx),
      colorPrimary: accent,
      colorBackground: t('--color-surface-overlay'),
      colorText: t('--color-content'),
      colorTextSecondary: t('--color-content-muted'),
      colorTextPlaceholder: t('--color-content-subtle'),
      colorDanger: t('--color-danger-500'),
      // The accent is this palette's positive hue — there is no separate green —
      // and it already lightens itself in dark mode.
      colorSuccess: accent,
    }),
    rules: {
      // `Input` in `ui/Input.tsx`: one strong line, no shadow, accent on focus.
      // Stripe's default is a shadowed field, which reads as a different
      // component from the fields directly above it in the same dialog.
      '.Input': compact({
        border: line ? `1px solid ${line}` : '',
        boxShadow: 'none',
      }),
      '.Input:focus': compact({
        border: accent ? `1px solid ${accent}` : '',
        boxShadow: 'none',
      }),
    },
  };
}
