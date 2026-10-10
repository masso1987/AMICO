/**
 * AMICO brand tokens, sampled from docs/brand/amico-logo.jpg.
 * Dark navy ground, glowing gold sphere, bronze lettering.
 */
export const BRAND = {
  name: 'AMICO',
  fullName: 'AMICO Cameroon',
  legalName: 'Alpha Multi-Integrated Corporation',
  country: 'CM',
  currency: 'XAF',
} as const;

export const colors = {
  /** Backgrounds */
  navy950: '#0E1116',
  navy900: '#191B27',
  navy800: '#232838',
  /** Gold: primary accent (buttons, highlights, focus rings) */
  gold500: '#F09E32',
  gold300: '#FFCB60',
  gold700: '#B8731F',
  /** Bronze: secondary text on dark, wordmark */
  bronze500: '#9C724C',
  /** Neutrals */
  white: '#FFFFFF',
  slate300: '#C5CAD6',
  slate500: '#7A8194',
  /** Status (kept distinct from gold so warnings never look like brand accents) */
  success: '#2FB37A',
  danger: '#E5484D',
  info: '#4C8DF6',
  /** Simulation banner: must never be mistaken for a real-money state. */
  simulation: '#8B5CF6',
} as const;

export const theme = {
  dark: {
    background: colors.navy950,
    surface: colors.navy900,
    surfaceRaised: colors.navy800,
    text: colors.white,
    textMuted: colors.slate300,
    primary: colors.gold500,
    primaryText: colors.navy950,
    accent: colors.gold300,
    border: '#2E3446',
  },
  light: {
    background: '#FAF8F4',
    surface: colors.white,
    surfaceRaised: '#F3EFE7',
    text: colors.navy950,
    textMuted: colors.slate500,
    // Darker gold keeps 4.5:1 contrast on light backgrounds.
    primary: colors.gold700,
    primaryText: colors.white,
    accent: colors.gold500,
    border: '#E4DED2',
  },
} as const;

export const typography = {
  /** Wordmark is a classic serif; UI text uses a clean sans. */
  display: "'Cinzel', 'Trajan Pro', Georgia, serif",
  body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
