/**
 * Brand tokens as values (BUILD_PLAN Part 4).
 *
 * `tokens.css` is the source of truth for anything rendered. This file mirrors
 * the same values for the places CSS cannot reach: a manifest `theme_color`, an
 * SVG fill generated in TypeScript, a chart series colour.
 *
 * The contrast ratios are recorded because the plan is explicit that the
 * signature orange fails against white for text, and that is exactly the rule
 * someone breaks by reaching for `--brand-500` when they want an accent.
 */

export const brand = {
  50: '#FFF8EC',
  100: '#FFEFD1',
  300: '#FBC96B',
  /** 2.0:1 on white. Fills, illustrations and large shapes. Never text. */
  500: '#F5A623',
  /** Hover and borders. */
  600: '#D98A0B',
  /** 4.2:1 on white. Large text ≥24px, UI components, icons. */
  700: '#B36A00',
  /** 4.8:1 on white. Body text — the lightest shade that passes WCAG AA. */
  800: '#A85C00',
  /** Headings and high emphasis. */
  900: '#6B3A00',
} as const;

export const neutral = {
  white: '#FFFFFF',
  /** 16.1:1 on white. */
  ink: '#1A1A1A',
  inkMuted: '#5C5C5C',
  border: '#E6E6E6',
} as const;

export const semantic = {
  success: '#1B7F4B',
  warning: '#B36A00',
  danger: '#B3261E',
} as const;

/** Which shades may carry text on a white surface, and at what size. */
export const textSafeOnWhite = {
  body: brand[800],
  largeText: brand[700],
  heading: brand[900],
} as const;

/**
 * The one shade that must never carry text.
 * Exported so a lint rule or a review comment can point at something concrete.
 */
export const decorativeOnly = brand[500];

export type BrandShade = keyof typeof brand;

export const themeColor = brand[500];
export const darkSurface = '#17150F';
