// What the start screen offers besides new and recent drawings (M7-07, UI_SPEC.md §10): sample
// drawings from the public corpus, the "Coming from AutoCAD" guide and the learn links. AutoCAD
// 2024's Start tab ("Start Tab", AutoCAD Help) has Open, New with its templates, Recent Documents
// with thumbnails and a Learning page; Triya's adds Open PDF (redline.ts), its samples, the guide
// and the privacy statement.
//
// Each sample is a redistributable corpus drawing (MIT, corpus/README.md), served as a file of
// its own that the app fetches from itself when the sample is opened (the service worker caches
// it on first use or by its warm-up, offline-cache.ts), and pictured by its reviewed golden image
// (M1-24), so the picture is what Triya draws when it opens.
import dimensionInBlock from '../../../corpus/public/third-party/ezdxf/examples_dxf/dimension_in_block.dxf?url';
import dimensionInBlockPicture from '../../../corpus/public/refs/golden/ezdxf/examples_dxf/dimension_in_block.dxf/model.png?url';
import hatches from '../../../corpus/public/third-party/ezdxf/examples_dxf/hatches_2.dxf?url';
import hatchesPicture from '../../../corpus/public/refs/golden/ezdxf/examples_dxf/hatches_2.dxf/model.png?url';
import multileaders from '../../../corpus/public/self-authored/multileaders.dxf?url';
import multileadersPicture from '../../../corpus/public/refs/golden/self-authored/multileaders.dxf/model.png?url';
import textAlignments from '../../../corpus/public/third-party/ezdxf/examples_dxf/text_alignments.dxf?url';
import textAlignmentsPicture from '../../../corpus/public/refs/golden/ezdxf/examples_dxf/text_alignments.dxf/model.png?url';
import viewportOverrides from '../../../corpus/public/self-authored/viewport-overrides.dxf?url';
import viewportOverridesPicture from '../../../corpus/public/refs/golden/self-authored/viewport-overrides.dxf/layout-Layout1.png?url';
import wipeoutDoor from '../../../corpus/public/third-party/ezdxf/examples_dxf/wipeout_door.dxf?url';
import wipeoutDoorPicture from '../../../corpus/public/refs/golden/ezdxf/examples_dxf/wipeout_door.dxf/model.png?url';

export interface Sample {
  readonly id: string;
  /** As the start screen names it. */
  readonly name: string;
  /** The file name the drawing opens as. */
  readonly file: string;
  /** What it shows, one sentence. */
  readonly description: string;
  /** Where it comes from, with its licence. */
  readonly source: string;
  /** The drawing, repository-relative (its corpus.json entry). */
  readonly corpus: string;
  /** Its picture, repository-relative. */
  readonly picturePath: string;
  /** The URLs the app serves them at. */
  readonly url: string;
  readonly picture: string;
}

const EZDXF = 'ezdxf examples (MIT)';
const TRIYA = 'Triya test drawings (MIT)';

export const SAMPLES: readonly Sample[] = [
  {
    id: 'hatches',
    name: 'Hatches',
    file: 'hatches_2.dxf',
    description: 'Solid and pattern hatches with holes, islands and spline edges.',
    source: EZDXF,
    corpus: 'corpus/public/third-party/ezdxf/examples_dxf/hatches_2.dxf',
    picturePath: 'corpus/public/refs/golden/ezdxf/examples_dxf/hatches_2.dxf/model.png',
    url: hatches,
    picture: hatchesPicture,
  },
  {
    id: 'wipeouts',
    name: 'Blocks and wipeouts',
    file: 'wipeout_door.dxf',
    description: 'A door block whose wipeout masks the wall behind it, inserted and exploded.',
    source: EZDXF,
    corpus: 'corpus/public/third-party/ezdxf/examples_dxf/wipeout_door.dxf',
    picturePath: 'corpus/public/refs/golden/ezdxf/examples_dxf/wipeout_door.dxf/model.png',
    url: wipeoutDoor,
    picture: wipeoutDoorPicture,
  },
  {
    id: 'dimensions',
    name: 'Dimensions',
    file: 'dimension_in_block.dxf',
    description: 'Linear and aligned dimensions, some of them inside blocks.',
    source: EZDXF,
    corpus: 'corpus/public/third-party/ezdxf/examples_dxf/dimension_in_block.dxf',
    picturePath: 'corpus/public/refs/golden/ezdxf/examples_dxf/dimension_in_block.dxf/model.png',
    url: dimensionInBlock,
    picture: dimensionInBlockPicture,
  },
  {
    id: 'text',
    name: 'Text alignments',
    file: 'text_alignments.dxf',
    description: 'Single-line text in every justification, fitted and aligned.',
    source: EZDXF,
    corpus: 'corpus/public/third-party/ezdxf/examples_dxf/text_alignments.dxf',
    picturePath: 'corpus/public/refs/golden/ezdxf/examples_dxf/text_alignments.dxf/model.png',
    url: textAlignments,
    picture: textAlignmentsPicture,
  },
  {
    id: 'multileaders',
    name: 'Multileaders',
    file: 'multileaders.dxf',
    description: 'Multileaders with blocks, attributes and leader line overrides.',
    source: TRIYA,
    corpus: 'corpus/public/self-authored/multileaders.dxf',
    picturePath: 'corpus/public/refs/golden/self-authored/multileaders.dxf/model.png',
    url: multileaders,
    picture: multileadersPicture,
  },
  {
    id: 'viewports',
    name: 'Layout viewports',
    file: 'viewport-overrides.dxf',
    description: 'A layout with clipped viewports, each with its own layer overrides.',
    source: TRIYA,
    corpus: 'corpus/public/self-authored/viewport-overrides.dxf',
    picturePath:
      'corpus/public/refs/golden/self-authored/viewport-overrides.dxf/layout-Layout1.png',
    url: viewportOverrides,
    picture: viewportOverridesPicture,
  },
];

/** A command the guide names, with the aliases it shows (each one Triya's, start-screen.test). */
export interface GuideCommand {
  readonly name: string;
  readonly aliases?: readonly string[];
}

/** A key the guide names, with the keyboard map action it does by default. */
export interface GuideKey {
  readonly key: string;
  readonly action: string;
  readonly label: string;
}

export interface GuideItem {
  readonly text: string;
  readonly commands?: readonly GuideCommand[];
  readonly keys?: readonly GuideKey[];
}

export interface GuideSection {
  readonly title: string;
  readonly items: readonly GuideItem[];
}

/** The "Coming from AutoCAD" guide (UI_SPEC.md §10). */
export const GUIDE: readonly GuideSection[] = [
  {
    title: 'What works as in AutoCAD',
    items: [
      {
        text: 'Type commands and their aliases at the command line; they ask the same prompts, with the same options.',
        commands: [
          { name: 'LINE', aliases: ['L'] },
          { name: 'CIRCLE', aliases: ['C'] },
          { name: 'OFFSET', aliases: ['O'] },
          { name: 'TRIM', aliases: ['TR'] },
          { name: 'MOVE', aliases: ['M'] },
          { name: 'COPY', aliases: ['CO'] },
          { name: 'DIMLINEAR', aliases: ['DLI'] },
          { name: 'HATCH', aliases: ['H'] },
        ],
      },
      {
        text: 'Object snaps, Ortho, polar and object snap tracking, Dynamic Input, grips and selection windows, on their usual keys.',
        keys: [
          { key: 'F3', action: 'drafting:osnap', label: 'Object Snap' },
          { key: 'F8', action: 'drafting:ortho', label: 'Ortho' },
          { key: 'F10', action: 'drafting:polar', label: 'Polar' },
          { key: 'F11', action: 'drafting:otrack', label: 'Object Snap Tracking' },
          { key: 'F12', action: 'dyn', label: 'Dynamic Input' },
        ],
      },
      {
        text: 'The Properties palette, the command history and the command line where you expect them; Ctrl+K finds any command, setting or action by name.',
        keys: [
          { key: 'Ctrl+1', action: 'properties', label: 'Properties' },
          { key: 'F2', action: 'history', label: 'Command History' },
          { key: 'Ctrl+9', action: 'commandline', label: 'Command line' },
          { key: 'Ctrl+K', action: 'palette', label: 'Command palette' },
        ],
      },
      {
        text: 'Layers, blocks and attributes, xrefs, layouts and viewports, page setups and plot style tables work at AutoCAD depth. Your own aliases and keys can be set in Options.',
        commands: [
          { name: 'LAYER', aliases: ['LA'] },
          { name: 'INSERT', aliases: ['I'] },
          { name: 'XREF', aliases: ['XR'] },
          { name: 'OPTIONS', aliases: ['OP'] },
        ],
      },
    ],
  },
  {
    title: 'Files',
    items: [
      {
        text: 'Opens DXF files of any version, and DWG files from R13 to 2018 as well as it can.',
      },
      {
        text: 'Saves DXF only, as AutoCAD 2018 DXF (AC1032), which AutoCAD and most CAD programs open. A drawing opened from a DWG or an older DXF is saved as a new .dxf; the original is never overwritten.',
        commands: [{ name: 'QSAVE' }, { name: 'SAVEAS' }],
      },
      {
        text: 'Plots to PDF, with your own .ctb and .stb plot style tables.',
        commands: [{ name: 'PLOT' }],
        keys: [{ key: 'Ctrl+P', action: 'command:PLOT', label: 'Plot' }],
      },
      {
        text: 'SHX fonts a drawing names are drawn with Triya’s own stroke fonts; TrueType fonts come from this device or the font files you drop on the window.',
      },
    ],
  },
  {
    title: 'What is different',
    items: [
      { text: '2D only: no 3D modelling, and no LISP, VBA or CUI customization.' },
      {
        text: 'Annotative objects show and save as drawn, but new objects cannot be made annotative yet.',
      },
      {
        text: 'No account and no cloud: your drawings never leave this device. Unsaved work is autosaved in the browser and offered back if the page closes.',
      },
      { text: 'Installed, it works offline.' },
    ],
  },
  {
    title: 'Red-lining a PDF',
    items: [
      {
        text: 'Open PDF… on the start screen opens the PDF in a new drawing at its printed size. Calibrate scale takes two picks on the page and the distance they really are.',
        commands: [{ name: 'PDFATTACH' }, { name: 'SCALE', aliases: ['SC'] }],
      },
      {
        text: 'Then mark it up with revision clouds, text and leaders, and plot it to PDF.',
        commands: [
          { name: 'REVCLOUD' },
          { name: 'MTEXT', aliases: ['T'] },
          { name: 'MLEADER', aliases: ['MLD'] },
          { name: 'PLOT' },
        ],
      },
    ],
  },
];

export interface LearnLink {
  readonly label: string;
  readonly href: string;
}

export const LEARN_LINKS: readonly LearnLink[] = [
  {
    label: 'Command reference',
    href: 'https://github.com/shubhs650/triya-cad-2d/blob/main/docs/COMMANDS.md',
  },
  { label: 'Source code and issues', href: 'https://github.com/shubhs650/triya-cad-2d' },
  { label: 'Open Engineering Tools', href: 'https://openengtools.com/' },
];

/** A sample's bytes, fetched from the app itself (offline from the service worker's cache). */
export async function sampleFile(sample: Sample): Promise<Blob> {
  const r = await fetch(sample.url);
  if (!r.ok) throw new Error(`${sample.file} could not be read (${r.status})`);
  return r.blob();
}
