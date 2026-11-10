// -PLOT (M2-17 part 5): PLOT at the command line, for scripts. AutoCAD 2024 Help, "-PLOT
// (Command)": "Detailed plot configuration? [Yes/No] <No>:". No asks for the layout, a page
// setup, the output device and the file, then "Save changes to page setup" and "Proceed with
// plot"; Yes asks for every setting the Plot dialog holds, in the dialog's order: layout, output
// device, paper size, paper units, drawing orientation, upside down, plot area (and a window's
// corners), plot scale (Plotted Millimeters=Drawing Units, or Fit), plot offset (or Center), plot
// with plot styles, the plot style table (". for none"), plot with lineweights, then for model
// space the shade plot setting and for a layout "Scale lineweights with plot scale?", "Plot paper
// space first?" and "Hide paperspace objects?". "?" lists the names a prompt takes.
//
// Each default is what the Plot dialog opens on for that space (its page setup), which the app
// answers (`plotSetup`); the app plots what the answers make (`plotScript`), as the dialog's OK
// does. Triya's plotters all plot to a file, so the file's name is asked as AutoCAD asks it for
// its file-only devices (DWG To PDF.pc3): "Enter file name <…>:".
//
// Decisions where Triya differs or AutoCAD's help is silent (noted in the PR):
// - "Enter a page setup name" (part 6) takes a named page setup of the space's kind (model
//   space's, or the layouts'), case aside, or Enter for the space's own; the defaults that follow
//   are that page setup's. A name it lacks is reported and asked again (AutoCAD's help is silent).
// - The View plot area is not offered (M6-04), as the dialog does not offer it.
// - Shade plot and "Hide paperspace objects" are 3D settings: every answer is taken and the 2D
//   plot is the same, as AutoCAD's own is for 2D objects.
// - "Plot paper space first?" is the dialog's "Plot paperspace last" turned round (DXF 70 flag
//   512, ObjectARX drawViewportsFirst), so its default follows the page setup's flag.
import type { CommandContext, CommandGenerator } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type {
  PlotScriptArea,
  PlotScriptChoice,
  PlotScriptSettings,
  PlotScriptSetup,
} from './view/host';
import { viewRequest } from './view/zoom';
import type { Vec2 } from '../geom/types';

/** A part of -PLOT that asks its own prompts and returns what they gave. */
type Step<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const AREA_KEYWORDS: Readonly<Record<PlotScriptArea, string>> = {
  display: 'Display',
  extents: 'Extents',
  layout: 'Layout',
  limits: 'Limits',
  window: 'Window',
};
/** AutoCAD's order: [Display/Extents/Limits/View/Window], a layout's Layout in place of Limits. */
const AREA_ORDER: readonly PlotScriptArea[] = ['display', 'extents', 'layout', 'limits', 'window'];

const SHADE_PLOT = [
  'As displayed',
  'legacy Wireframe',
  'legacy Hidden',
  'Visual styles',
  'Rendered',
];

/** A number as -PLOT shows it: up to six decimals, no trailing zeros. */
function num(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

const keyword = (k: string): PromptAnswer => ({ kind: 'keyword', keyword: k });
const text = (value: string): PromptAnswer => ({ kind: 'string', value });

/** A Yes/No question; its answer, or undefined when the command ends. */
async function* yesNo(
  ctx: CommandContext,
  message: string,
  otherwise: boolean,
): Step<boolean | undefined> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    default: keyword(otherwise ? 'Yes' : 'No'),
  });
  return a.kind === 'keyword' ? a.keyword === 'Yes' : undefined;
}

/**
 * A name from a list, case aside, with `?` listing them; the default is `current`. Undefined
 * when the command ends.
 */
async function* pickName(
  ctx: CommandContext,
  message: string,
  names: readonly string[],
  current: string,
  missing: (typed: string) => string,
  /** What a typed name stands for besides the names listed (an id, a short form). */
  also: (typed: string) => string | undefined = () => undefined,
): Step<string | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: `${message} or`,
      options: ['?'],
      default: text(current),
      spaces: true,
    });
    if (a.kind === 'keyword') {
      for (const n of names) ctx.message(n);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    const typed = a.value.trim();
    if (typed === current) return current;
    const found = names.find((n) => n.toUpperCase() === typed.toUpperCase()) ?? also(typed);
    if (found !== undefined) return found;
    ctx.message(missing(typed));
  }
}

/** A choice by its name, its short form (the name before " (") or its id. */
function choiceNamed(choices: readonly PlotScriptChoice[], typed: string): string | undefined {
  const t = typed.toUpperCase();
  const short = (n: string) => n.replace(/\s*\(.*$/, '').toUpperCase();
  return choices.find(
    (c) => c.name.toUpperCase() === t || short(c.name) === t || c.id.toUpperCase() === t,
  )?.id;
}

const nameOf = (choices: readonly PlotScriptChoice[], id: string) =>
  choices.find((c) => c.id === id)?.name ?? id;

/** "a=b" or "a:b", both positive; undefined otherwise. */
export function parsePlotScale(typed: string): { plotted: number; units: number } | undefined {
  const m = /^\s*(\d*\.?\d+(?:e[+-]?\d+)?)\s*[=:]\s*(\d*\.?\d+(?:e[+-]?\d+)?)\s*$/i.exec(typed);
  if (!m) return undefined;
  const plotted = Number(m[1]);
  const units = Number(m[2]);
  return plotted > 0 && units > 0 ? { plotted, units } : undefined;
}

/** "x,y"; undefined otherwise. */
export function parsePlotOffset(typed: string): Vec2 | undefined {
  const m = /^\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*$/.exec(typed);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
}

async function setupOf(
  ctx: CommandContext,
  layout?: string,
  pageSetup?: string,
): Promise<PlotScriptSetup | undefined> {
  const r = await viewRequest(ctx, {
    op: 'plotSetup',
    ...(layout !== undefined && { layout }),
    ...(pageSetup !== undefined && { pageSetup }),
  });
  if (!r.ok) return undefined;
  if (!r.plotSetup) {
    ctx.message('There is nothing to plot.');
    return undefined;
  }
  return r.plotSetup;
}

/** The settings the detailed configuration asks for; undefined when the command ends. */
async function* detailed(
  ctx: CommandContext,
  setup: PlotScriptSetup,
  device: string,
): Step<PlotScriptSettings | undefined> {
  let s: PlotScriptSettings = { ...setup.settings, device };

  const paperNames = setup.papers.map((p) => p.name);
  const paperName = yield* pickName(
    ctx,
    'Enter paper size',
    paperNames,
    nameOf(setup.papers, s.paper),
    (t) => `Paper size "${t}" not found.`,
    (t) => {
      const id = choiceNamed(setup.papers, t);
      return id === undefined ? undefined : nameOf(setup.papers, id);
    },
  );
  if (paperName === undefined) return undefined;
  s = { ...s, paper: setup.papers.find((p) => p.name === paperName)!.id };

  const unitsAnswer = yield ctx.prompt.keyword({
    message: 'Enter paper units',
    options: ['Inches', 'Millimeters'],
    default: keyword(setup.inches ? 'Inches' : 'Millimeters'),
  });
  if (unitsAnswer.kind !== 'keyword') return undefined;
  const inches = unitsAnswer.keyword === 'Inches';
  const k = inches ? 25.4 : 1;

  const orientation = yield ctx.prompt.keyword({
    message: 'Enter drawing orientation',
    options: ['Portrait', 'Landscape'],
    default: keyword(s.orientation === 'portrait' ? 'Portrait' : 'Landscape'),
  });
  if (orientation.kind !== 'keyword') return undefined;
  s = { ...s, orientation: orientation.keyword === 'Portrait' ? 'portrait' : 'landscape' };

  const upsideDown = yield* yesNo(ctx, 'Plot upside down?', s.upsideDown);
  if (upsideDown === undefined) return undefined;
  s = { ...s, upsideDown };

  const areas = AREA_ORDER.filter((a) => setup.areas.includes(a));
  const area = yield ctx.prompt.keyword({
    message: 'Enter plot area',
    options: areas.map((a) => AREA_KEYWORDS[a]),
    default: keyword(AREA_KEYWORDS[areas.includes(s.area) ? s.area : areas[0]!]),
  });
  if (area.kind !== 'keyword') return undefined;
  const chosen = areas.find((a) => AREA_KEYWORDS[a] === area.keyword)!;
  s = { ...s, area: chosen };
  if (chosen === 'window') {
    const w = s.window;
    const lower = yield ctx.prompt.point({
      message: 'Enter lower left corner of window',
      default: { kind: 'point', point: w ? { x: w.minX, y: w.minY } : { x: 0, y: 0 } },
    });
    if (lower.kind !== 'point') return undefined;
    const upper = yield ctx.prompt.point({
      message: 'Enter upper right corner of window',
      default: { kind: 'point', point: w ? { x: w.maxX, y: w.maxY } : { x: 0, y: 0 } },
      rubberBand: { from: lower.point, box: true },
    });
    if (upper.kind !== 'point') return undefined;
    const [a, b] = [lower.point, upper.point];
    const window = {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
    if (!(window.maxX > window.minX && window.maxY > window.minY)) {
      ctx.message('The window has no area.');
      return undefined;
    }
    s = { ...s, window };
  }

  // The scale, in the paper units just chosen.
  for (;;) {
    const unit = inches ? 'Inches' : 'Millimeters';
    const a = yield ctx.prompt.string({
      message: `Enter plot scale (Plotted ${unit}=Drawing Units) or`,
      options: ['Fit'],
      default: s.fit ? keyword('Fit') : text(`${num(s.scale.mm / k)}=${num(s.scale.units)}`),
    });
    if (a.kind === 'keyword') {
      s = { ...s, fit: true };
      break;
    }
    if (a.kind !== 'string') return undefined;
    const scale = parsePlotScale(a.value);
    if (scale) {
      s = { ...s, fit: false, scale: { mm: scale.plotted * k, units: scale.units } };
      break;
    }
    ctx.message('Requires a scale as plotted units=drawing units, such as 1=100, or Fit.');
  }

  for (;;) {
    const o = s.offset;
    const a = yield ctx.prompt.string({
      message: 'Enter plot offset (x,y) or',
      options: ['Center'],
      default: s.center
        ? keyword('Center')
        : text(`${(o.x / k).toFixed(2)},${(o.y / k).toFixed(2)}`),
    });
    if (a.kind === 'keyword') {
      s = { ...s, center: true };
      break;
    }
    if (a.kind !== 'string') return undefined;
    const offset = parsePlotOffset(a.value);
    if (offset) {
      s = { ...s, center: false, offset: { x: offset.x * k, y: offset.y * k } };
      break;
    }
    ctx.message('Requires an offset as x,y, or Center.');
  }

  const plotStyles = yield* yesNo(ctx, 'Plot with plot styles?', s.plotStyles);
  if (plotStyles === undefined) return undefined;
  s = { ...s, plotStyles };

  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter plot style table name (enter . for none) or',
      options: ['?'],
      default: text(s.table),
      spaces: true,
    });
    if (a.kind === 'keyword') {
      for (const n of setup.tables) ctx.message(n);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    const typed = a.value.trim();
    // The page setup's own table stays, even one this device lacks (it plots as none).
    if (typed === s.table) break;
    if (typed === '.') {
      s = { ...s, table: '' };
      break;
    }
    const found = setup.tables.find((n) => n.toUpperCase() === typed.toUpperCase());
    if (found !== undefined) {
      s = { ...s, table: found };
      break;
    }
    ctx.message(`Plot style table "${typed}" not found.`);
  }

  const lineweights = yield* yesNo(ctx, 'Plot with lineweights?', s.lineweights);
  if (lineweights === undefined) return undefined;
  s = { ...s, lineweights };

  if (!setup.paper) {
    const shade = yield ctx.prompt.keyword({
      message: 'Enter shade plot setting',
      options: SHADE_PLOT,
      default: keyword(SHADE_PLOT[0]!),
    });
    if (shade.kind !== 'keyword') return undefined;
    return s;
  }
  const scaleLineweights = yield* yesNo(
    ctx,
    'Scale lineweights with plot scale?',
    s.scaleLineweights,
  );
  if (scaleLineweights === undefined) return undefined;
  const first = yield* yesNo(ctx, 'Plot paper space first?', !s.paperspaceLast);
  if (first === undefined) return undefined;
  const hide = yield* yesNo(ctx, 'Hide paperspace objects?', false);
  if (hide === undefined) return undefined;
  return { ...s, scaleLineweights, paperspaceLast: !first };
}

/** -PLOT. */
export async function* dashPlot(ctx: CommandContext): CommandGenerator {
  const full = yield* yesNo(ctx, 'Detailed plot configuration?', false);
  if (full === undefined) return;
  const shown = await setupOf(ctx);
  if (!shown) return;
  const layout = yield* pickName(
    ctx,
    'Enter a layout name',
    shown.layouts,
    shown.layout,
    (t) => `Layout "${t}" not found.`,
  );
  if (layout === undefined) return;
  let setup = layout === shown.layout ? shown : await setupOf(ctx, layout);
  if (!setup) return;

  let pageSetup: string | undefined;
  if (!full) {
    for (;;) {
      const a = yield ctx.prompt.string({
        message: 'Enter a page setup name',
        default: text(''),
        spaces: true,
      });
      if (a.kind !== 'string') return;
      const typed = a.value.trim();
      if (typed === '') break;
      pageSetup = setup.pageSetups.find((n) => n.toUpperCase() === typed.toUpperCase());
      if (pageSetup !== undefined) break;
      ctx.message(`Page setup "${typed}" not found.`);
    }
    if (pageSetup !== undefined) {
      setup = await setupOf(ctx, layout, pageSetup);
      if (!setup) return;
    }
  }

  const deviceName = yield* pickName(
    ctx,
    'Enter an output device name',
    setup.devices.map((d) => d.name),
    nameOf(setup.devices, setup.settings.device),
    (t) => `Output device "${t}" not found.`,
    (t) => {
      const id = choiceNamed(setup.devices, t);
      return id === undefined ? undefined : nameOf(setup.devices, id);
    },
  );
  if (deviceName === undefined) return;
  const device = setup.devices.find((d) => d.name === deviceName)!.id;

  let settings: PlotScriptSettings | undefined = { ...setup.settings, device };
  if (full) {
    settings = yield* detailed(ctx, setup, device);
    if (!settings) return;
  }

  const fileAnswer = yield ctx.prompt.string({
    message: 'Enter file name',
    default: text(withExtension(setup.file, device)),
    spaces: true,
  });
  if (fileAnswer.kind !== 'string') return;
  const file = withExtension(fileAnswer.value.trim() || setup.file, device);

  let save = false;
  if (setup.canSave) {
    const answer = yield* yesNo(ctx, 'Save changes to page setup?', false);
    if (answer === undefined) return;
    save = answer;
  }
  const plot = yield* yesNo(ctx, 'Proceed with plot?', true);
  if (plot === undefined || (!plot && !save)) return;
  await viewRequest(ctx, {
    op: 'plotScript',
    script: { layout, ...(pageSetup !== undefined && { pageSetup }), settings, file, save, plot },
  });
}

/** The file named, with the device's extension unless it has it. */
function withExtension(file: string, device: string): string {
  const ext = `.${device.toLowerCase()}`;
  const base = file.replace(/\.(pdf|svg|png)$/i, '');
  return file.toLowerCase().endsWith(ext) ? file : `${base}${ext}`;
}
