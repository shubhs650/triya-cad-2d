// -EXPORT (M2-39 part 5): EXPORT at the command line, for scripts. AutoCAD 2024 Help, "-EXPORT
// (Command)": "Enter file format [Dwf/dwfX/Pdf] <dwf>:", then "Enter plot area" (Display, Extents
// or Window in model space; Current layout or All layouts in a layout), "Detailed plot
// configuration? [Yes/No] <No>:" (Yes asks the plot settings as -PLOT does) and the file's name.
// The formats are Triya's, as Export Data's Files of type lists them: [Pdf/Svg/pNg/Dxf], PDF
// first (AutoCAD's default is its own DWF, which Triya does not write). Each default is what the
// Export Data dialog opens on for the space shown (its page setup), which the app answers
// (`plotSetup`); the app writes what the answers make (`exportScript`), as the dialog's Save does.
//
// Decisions where AutoCAD's help is silent (noted in the PR):
// - DXF is the whole drawing, so it asks the file name only, as Export Data asks nothing else.
// - Window asks "Specify first corner:" and "Specify opposite corner:", as EXPORTPDF's Window does.
// - All layouts plots each layout with its own page setup, as PUBLISH does, so the detailed
//   configuration is not asked for it.
// - The file names are the dialog's: "<drawing>-<space>.<type>", "<drawing>.pdf" or
//   "<drawing>.zip" for All layouts (a ZIP of a file a layout, part 4), "<drawing>.dxf".
import type { CommandContext, CommandGenerator } from './command';
import type { PromptAnswer } from './prompt';
import { detailed, setupOf, yesNo } from './plot-script';
import type { ExportScript, PlotScriptSettings } from './view/host';
import { viewRequest } from './view/zoom';
import type { Box } from '../geom/bounds';

type ExportType = ExportScript['type'];
type ExportArea = NonNullable<ExportScript['area']>;

const FORMATS: readonly (readonly [string, ExportType])[] = [
  ['Pdf', 'pdf'],
  ['Svg', 'svg'],
  ['pNg', 'png'],
  ['Dxf', 'dxf'],
];

const AREAS: Readonly<Record<ExportArea, string>> = {
  display: 'Display',
  extents: 'Extents',
  window: 'Window',
  current: 'Current layout',
  all: 'All layouts',
};

const keyword = (k: string): PromptAnswer => ({ kind: 'keyword', keyword: k });
const unsafe = /[\\/:*?"<>|]/g;

/** The file -EXPORT suggests, as the Export Data dialog names it. */
function suggested(
  drawing: string,
  space: string,
  type: ExportType,
  area: ExportArea | undefined,
): string {
  const base = drawing.replace(/\.[^.]+$/, '') || 'Drawing1';
  const name =
    type === 'dxf'
      ? `${base}.dxf`
      : area === 'all'
        ? `${base}.${type === 'pdf' ? 'pdf' : 'zip'}`
        : `${base}-${space}.${type}`;
  return name.replace(unsafe, '_');
}

/** The name typed, with the extension the export writes unless it has it. */
function withExtension(file: string, ext: string): string {
  if (file.toLowerCase().endsWith(`.${ext}`)) return file;
  return `${file.replace(/\.(pdf|svg|png|dxf|zip)$/i, '')}.${ext}`;
}

/** -EXPORT. */
export async function* dashExport(ctx: CommandContext): CommandGenerator {
  const format = yield ctx.prompt.keyword({
    message: 'Enter file format',
    options: FORMATS.map(([k]) => k),
    default: keyword('Pdf'),
  });
  if (format.kind !== 'keyword') return;
  const type = FORMATS.find(([k]) => k === format.keyword)![1];
  const setup = await setupOf(ctx);
  if (!setup) return;
  // The drawing's name: the app's, or the plot file's less its "-<space>.pdf".
  const drawing =
    setup.drawing ?? setup.file.replace(new RegExp(`-${setup.layout}\\.[^.]+$`), '.dxf');

  let area: ExportArea | undefined;
  let window: Box | undefined;
  let settings: PlotScriptSettings | undefined;
  if (type !== 'dxf') {
    const areas: ExportArea[] = setup.paper
      ? ['current', 'all']
      : (['display', 'extents', 'window'] as const).filter(
          (a) => a === 'window' || setup.areas.includes(a),
        );
    const picked = yield ctx.prompt.keyword({
      message: 'Enter plot area',
      options: areas.map((a) => AREAS[a]),
      default: keyword(AREAS[areas[0]!]),
    });
    if (picked.kind !== 'keyword') return;
    area = areas.find((a) => AREAS[a] === picked.keyword)!;
    if (area === 'window') {
      const first = yield ctx.prompt.point({ message: 'Specify first corner' });
      if (first.kind !== 'point') return;
      const a = first.point;
      const second = yield ctx.prompt.point({
        message: 'Specify opposite corner',
        rubberBand: { from: a, box: true },
      });
      if (second.kind !== 'point') return;
      const b = second.point;
      window = {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      };
      if (!(window.maxX > window.minX && window.maxY > window.minY)) {
        ctx.message('The window has no area.');
        return;
      }
    }
    if (area !== 'all') {
      const full = yield* yesNo(ctx, 'Detailed plot configuration?', false);
      if (full === undefined) return;
      if (full) {
        // A layout's Current layout plots its page setup's own area.
        const fixed =
          area === 'current'
            ? { area: setup.settings.area, window: setup.settings.window }
            : { area, window };
        settings = yield* detailed(ctx, setup, type, fixed);
        if (!settings) return;
      }
    }
  }

  const file = suggested(drawing, setup.layout, type, area);
  const ext = file.slice(file.lastIndexOf('.') + 1);
  const answer = yield ctx.prompt.string({
    message: 'Enter file name',
    default: { kind: 'string', value: file },
    spaces: true,
  });
  if (answer.kind !== 'string') return;
  const script: ExportScript = {
    type,
    ...(area !== undefined && { area }),
    ...(window && { window }),
    file: withExtension(answer.value.trim() || file, ext),
    ...(settings && { settings }),
  };
  await viewRequest(ctx, { op: 'exportScript', script });
}
