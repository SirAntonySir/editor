import type { Anchor } from '@/lib/perceptual-dial/types';

/**
 * Anchor values for the Time-of-Day perceptual dial.
 *
 * `kelvin.kelvin` is stored in the **shader convention** — high value =
 * warmer apparent image. See `src/lib/kelvin-direction.ts` for the rule
 * and `src/shaders/kelvin.glsl.ts` for the math. Each kelvin number here
 * is `2 * 6500 - physical_kelvin` of the lighting condition it emulates
 * (e.g. dawn ≈ 3200 K physical light → stored 9800).
 *
 * All other params are plain shader values in their natural ranges.
 *
 * Keep this in lockstep with `backend/app/tools/fused/_time_of_day_data.py`.
 */
export const TIME_OF_DAY_ANCHORS: Anchor[] = [
  {
    id: 'dawn',
    label: 'Dawn',
    position: [0.10],
    params: {
      'kelvin.kelvin':     9800,
      'light.exposure':     -0.3,
      'light.contrast':     -8,
      'light.highlights':  -15,
      'light.shadows':     +20,
      'color.vibrance':     +5,
      'hsl.orange_sat':    +10,
      'hsl.blue_sat':      +15,
      'filters.vignette_amount': -10,
    },
  },
  {
    id: 'noon',
    label: 'Noon',
    position: [0.30],
    params: {
      'kelvin.kelvin':     7500,
      'light.exposure':      0,
      'light.contrast':    +10,
      'light.highlights':    0,
      'light.shadows':       0,
      'color.vibrance':      0,
      'hsl.orange_sat':      0,
      'hsl.blue_sat':      +15,
      'filters.vignette_amount': 0,
    },
  },
  {
    id: 'golden',
    label: 'Golden',
    position: [0.55],
    params: {
      'kelvin.kelvin':     9600,
      'light.exposure':     +0.2,
      'light.contrast':     +5,
      'light.highlights':  -20,
      'light.shadows':     +10,
      'color.vibrance':    +12,
      'hsl.orange_sat':    +25,
      'hsl.blue_sat':       -5,
      'filters.vignette_amount': -8,
    },
  },
  {
    id: 'blue',
    label: 'Blue',
    position: [0.80],
    params: {
      'kelvin.kelvin':     4500,
      'light.exposure':     -0.5,
      'light.contrast':    +15,
      'light.highlights':  -10,
      'light.shadows':      +5,
      'color.vibrance':     +5,
      'hsl.orange_sat':    -25,
      'hsl.blue_sat':      +20,
      'filters.vignette_amount': -15,
    },
  },
  {
    id: 'night',
    label: 'Night',
    position: [1.00],
    params: {
      'kelvin.kelvin':     8800,
      'light.exposure':     -1.2,
      'light.contrast':    +25,
      'light.highlights':  -40,
      'light.shadows':     -10,
      'color.vibrance':     +8,
      'hsl.orange_sat':    -10,
      'hsl.blue_sat':      +15,
      'filters.vignette_amount': -30,
    },
  },
];
