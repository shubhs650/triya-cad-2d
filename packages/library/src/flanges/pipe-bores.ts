// Inside diameters of welded and seamless steel pipe, NPS ½ to 24, by schedule (ASME B36.10M):
// the bore of a weld neck flange, which B16.5 leaves to the purchaser to match the pipe, and of
// a socket welding flange's through bore. Inches; `null`: no such schedule in that size.
// Transcribed from Texas Flange's weld neck bore chart (texasflange.com, read 2026-11-28),
// whose values are OD − 2 × B36.10M's nominal wall; B16.5's Class 150 and 300 charts give the
// standard-wall bore (their B2) to two decimals, which the tests check these against.

/** The schedules and wall designations the bore table has a column for. */
export const PIPE_SCHEDULES = [
  '10',
  '20',
  '30',
  'STD',
  '40',
  '60',
  'XS',
  '80',
  '100',
  '120',
  '140',
  '160',
  'XXS',
] as const;
export type PipeSchedule = (typeof PIPE_SCHEDULES)[number];

/** [nps, outside diameter, then the inside diameter for each of PIPE_SCHEDULES in order]. */
const BORES: readonly (readonly (number | null)[])[] = [
  [0.5, 0.84, 0.674, null, null, 0.622, 0.622, null, 0.546, 0.546, null, null, null, 0.464, 0.252],
  [0.75, 1.05, 0.884, null, null, 0.824, 0.824, null, 0.742, 0.742, null, null, null, 0.612, 0.434],
  [1, 1.315, 1.097, null, null, 1.049, 1.049, null, 0.957, 0.957, null, null, null, 0.815, 0.599],
  [1.25, 1.66, 1.442, null, null, 1.38, 1.38, null, 1.278, 1.278, null, null, null, 1.16, 0.896],
  [1.5, 1.9, 1.682, null, null, 1.61, 1.61, null, 1.5, 1.5, null, null, null, 1.338, 1.1],
  [2, 2.375, 2.157, null, null, 2.067, 2.067, null, 1.939, 1.939, null, null, null, 1.687, 1.503],
  [2.5, 2.875, 2.635, null, null, 2.469, 2.469, null, 2.323, 2.323, null, null, null, 2.125, 1.771],
  [3, 3.5, 3.26, null, null, 3.068, 3.068, null, 2.9, 2.9, null, null, null, 2.624, 2.3],
  [3.5, 4, 3.76, null, null, 3.548, 3.548, null, 3.364, 3.364, null, null, null, null, 2.728],
  [4, 4.5, 4.26, null, null, 4.026, 4.026, null, 3.826, 3.826, null, 3.624, null, 3.438, 3.152],
  [5, 5.563, 5.295, null, null, 5.047, 5.047, null, 4.813, 4.813, null, 4.563, null, 4.313, 4.063],
  [6, 6.625, 6.357, null, null, 6.065, 6.065, null, 5.761, 5.761, null, 5.501, null, 5.187, 4.897],
  [
    8, 8.625, 8.329, 8.125, 8.071, 7.981, 7.981, 7.813, 7.625, 7.625, 7.437, 7.187, 7.001, 6.813,
    6.875,
  ],
  [10, 10.75, 10.42, 10.25, 10.136, 10.02, 10.02, 9.75, 9.75, 9.562, 9.312, 9.062, 8.75, 8.5, 8.75],
  [
    12, 12.75, 12.39, 12.25, 12.09, 12, 11.938, 11.626, 11.75, 11.374, 11.062, 10.75, 10.5, 10.126,
    10.75,
  ],
  [
    14,
    14,
    13.5,
    13.376,
    13.25,
    13.25,
    13.124,
    12.812,
    13,
    12.5,
    12.124,
    11.812,
    11.5,
    11.188,
    null,
  ],
  [
    16,
    16,
    15.5,
    15.376,
    15.25,
    15.25,
    15,
    14.688,
    15,
    14.312,
    13.938,
    13.562,
    13.124,
    12.812,
    null,
  ],
  [
    18,
    18,
    17.5,
    17.376,
    17.124,
    17.25,
    16.876,
    16.5,
    17,
    16.124,
    15.688,
    15.25,
    14.876,
    14.438,
    null,
  ],
  [20, 20, 19.5, 19.25, 19, 19.25, 18.812, 18.376, 19, 17.938, 17.438, 17, 16.5, 16.062, null],
  [22, 22, 21.5, null, null, 21.25, null, null, 21, null, null, null, null, null, null],
  [
    24,
    24,
    23.5,
    23.25,
    22.876,
    23.25,
    22.624,
    22.062,
    23,
    21.562,
    20.938,
    20.376,
    19.876,
    19.312,
    null,
  ],
];

/** Pipe NPS `nps`'s outside diameter, inches; undefined for a size the table lacks. */
export function pipeOutsideDiameter(nps: number): number | undefined {
  return BORES.find((r) => r[0] === nps)?.[1] ?? undefined;
}

/** Pipe NPS `nps`'s inside diameter in `schedule`, inches; undefined where there is none. */
export function pipeBore(nps: number, schedule: PipeSchedule): number | undefined {
  const row = BORES.find((r) => r[0] === nps);
  return row?.[2 + PIPE_SCHEDULES.indexOf(schedule)] ?? undefined;
}
