// M2-07: TEXT (DTEXT) and MTEXT on the PromptBus, with AutoCAD 2024's prompts ("TEXT (Command)"
// and "MTEXT (Command)", AutoCAD 2024 Help). The in-place editors are front-ends: a prompt says
// where the editor goes, and the MTEXT editor answers with the whole contents at once.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type HeaderValue,
  type MTextGeometry,
  type StringPrompt,
  type TextGeometry,
  type TextStyleRecord,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, sampleInit } from '../model/fixtures';

const STANDARD = '30';
const NOTES = '31';
const FIXED = '32';

const style = (handle: string, name: string, extra: Partial<TextStyleRecord> = {}) =>
  ({
    handle,
    name,
    font: 'arial.ttf',
    height: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    lastHeight: 2.5,
    generation: 0,
    trueTypeFlags: 0,
    ...extra,
  }) satisfies TextStyleRecord;

function setup(header: [string, HeaderValue][] = []) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$TEXTSTYLE', 'Standard'], ...header]),
    tables: {
      ...init.tables,
      textStyles: [
        style(STANDARD, 'Standard'),
        style(NOTES, 'Notes', { widthFactor: 0.8, obliqueAngle: 0.25, generation: 2 }),
        style(FIXED, 'Fixed', { height: 5 }),
      ],
    },
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const texts = () => added().map((e) => e.geom as TextGeometry);
  return { model, bus, added, texts };
}

const near = (v: number) => Math.round(v * 1e9) / 1e9;

describe('TEXT', () => {
  it('places lines below each other with the current style, height and rotation', async () => {
    const { model, bus, added, texts } = setup();
    await bus.submit('DT');
    expect(bus.history.at(-1)).toBe(
      'Current text style:  "Standard"  Text height:  2.5000  Annotative:  No  Justify:  Left',
    );
    expect(bus.promptText).toBe('Specify start point of text or [Justify/Style]:');
    await bus.submit('10,20');
    expect(bus.promptText).toBe('Specify height <2.5000>:');
    await bus.submit('3');
    expect(bus.promptText).toBe('Specify rotation angle of text <0>:');
    await bus.submit('90');
    expect(bus.prompt).toMatchObject({
      kind: 'string',
      message: 'Enter text',
      spaces: true,
      editor: { kind: 'text', position: { x: 10, y: 20 }, height: 3, rotation: Math.PI / 2 },
    });
    await bus.script(['First line', '  second, indented', '']);
    expect(bus.command).toBeUndefined();
    expect(added().map((e) => [e.type, e.owner, e.layer])).toEqual([
      ['TEXT', MODEL_SPACE, LAYER_WALLS],
      ['TEXT', MODEL_SPACE, LAYER_WALLS],
    ]);
    const [a, b] = texts();
    expect(a).toMatchObject({
      value: 'First line',
      style: STANDARD,
      position: { x: 10, y: 20 },
      height: 3,
      rotation: Math.PI / 2,
      widthFactor: 1,
      oblique: 0,
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: false,
    });
    expect(a!.alignmentPoint).toBeUndefined();
    // The next line starts one line (5/3 of the height) below, along the text's own down.
    expect(b!.value).toBe('  second, indented');
    expect([near(b!.position.x), near(b!.position.y)]).toEqual([15, 20]);
    // TEXTSIZE follows the height used, as in AutoCAD.
    expect(model.header.get('$TEXTSIZE')).toBe(3);
  });

  it('runs as DTEXT too', async () => {
    const { bus } = setup();
    await bus.submit('DTEXT');
    expect(bus.command).toBe('TEXT');
  });

  it('takes the height and rotation it was last given as defaults', async () => {
    const { bus } = setup([['$TEXTSIZE', 4]]);
    await bus.script(['TEXT', '0,0']);
    expect(bus.promptText).toBe('Specify height <4.0000>:');
    await bus.script(['', '']);
    expect(bus.prompt?.kind).toBe('string');
  });

  it('does not ask the height of a style with a fixed height', async () => {
    const { bus, texts } = setup();
    await bus.script(['TEXT', 'S', 'fixed', '0,0']);
    expect(bus.promptText).toBe('Specify rotation angle of text <0>:');
    await bus.script(['', 'abc', '']);
    expect(texts()[0]).toMatchObject({ style: FIXED, height: 5 });
  });

  it('refuses a style the drawing does not have and asks again', async () => {
    const { bus } = setup();
    await bus.script(['TEXT', 'S', 'Nope']);
    expect(bus.history.at(-1)).toBe('Cannot find text style "Nope".');
    expect(bus.promptText).toBe('Enter style name or [?] <Standard>:');
    await bus.submit('?');
    expect(bus.history.slice(-4)).toEqual(['Text styles:', '  Fixed', '  Notes', '  Standard']);
  });

  it('takes the width factor, obliquing and backwards flag of the style', async () => {
    const { bus, texts } = setup();
    await bus.script(['TEXT', 'S', 'Notes', '0,0', '', '', 'x', '']);
    expect(texts()[0]).toMatchObject({
      style: NOTES,
      widthFactor: 0.8,
      oblique: 0.25,
      backward: true,
    });
  });

  it('places justified text by its alignment point', async () => {
    const { bus, texts } = setup();
    await bus.submit('TEXT');
    await bus.submit('J');
    expect(bus.promptText).toBe(
      'Enter an option [Left/Center/Right/Align/Middle/Fit/TL/TC/TR/ML/MC/MR/BL/BC/BR]:',
    );
    await bus.submit('MC');
    expect(bus.promptText).toBe('Specify middle point of text:');
    await bus.script(['5,5', '', '', 'mid', 'next', '']);
    const [a, b] = texts();
    expect(a).toMatchObject({
      halign: 1,
      valign: 2,
      position: { x: 5, y: 5 },
      alignmentPoint: { x: 5, y: 5 },
    });
    expect(b!.alignmentPoint).toEqual({ x: 5, y: 5 - 2.5 * (5 / 3) });
  });

  it('places Align text between two baseline points, asking neither height nor angle', async () => {
    const { bus, texts } = setup();
    await bus.script(['TEXT', 'J', 'A']);
    expect(bus.promptText).toBe('Specify first endpoint of text baseline:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify second endpoint of text baseline:');
    await bus.script(['0,10', 'fits', '']);
    expect(texts()[0]).toMatchObject({
      halign: 3,
      valign: 0,
      position: { x: 0, y: 0 },
      alignmentPoint: { x: 0, y: 10 },
      rotation: Math.PI / 2,
    });
  });

  it('asks the height of Fit text but not its angle', async () => {
    const { bus, texts } = setup();
    await bus.script(['TEXT', 'J', 'F', '0,0', '10,0']);
    expect(bus.promptText).toBe('Specify height <2.5000>:');
    await bus.script(['2', 'fit', '']);
    expect(texts()[0]).toMatchObject({ halign: 5, height: 2, alignmentPoint: { x: 10, y: 0 } });
  });

  it('continues below the last text when Enter is given for the start point', async () => {
    const { bus, texts } = setup();
    await bus.script(['TEXT', '0,0', '', '', 'one', '']);
    await bus.script(['TEXT', '']);
    expect(bus.prompt?.kind).toBe('string');
    await bus.script(['two', '']);
    expect(texts()[1]!.position.y).toBeCloseTo(-2.5 * (5 / 3), 9);
  });

  it('says there is nothing to continue before any text was placed', async () => {
    const { bus } = setup();
    await bus.script(['TEXT', '']);
    expect(bus.history.at(-1)).toBe('No text to continue.');
    expect(bus.promptText).toBe('Specify start point of text or [Justify/Style]:');
  });

  it('keeps the lines already placed when cancelled', async () => {
    const { bus, texts } = setup();
    await bus.script(['TEXT', '0,0', '', '', 'kept']);
    await bus.cancel();
    expect(texts().map((t) => t.value)).toEqual(['kept']);
  });
});

describe('TEXT and MTEXT in the drawing units (M2-35 part 17)', () => {
  it('report the text height and show defaults in feet and inches', async () => {
    const { bus } = setup([
      ['$LUNITS', 4],
      ['$LUPREC', 4],
      ['$AUNITS', 1],
    ]);
    await bus.submit('DT');
    expect(bus.history.at(-1)).toBe(
      `Current text style:  "Standard"  Text height:  0'-2 1/2"  Annotative:  No  Justify:  Left`,
    );
    await bus.submit('10,20');
    expect(bus.promptText).toBe(`Specify height <0'-2 1/2">:`);
    await bus.submit(`3/16"`);
    expect(bus.promptText).toBe('Specify rotation angle of text <0d>:');
    await bus.cancel();
    await bus.submit('MT');
    expect(bus.history.at(-1)).toBe(
      `Current text style:  "Standard"  Text height:  0'-2 1/2"  Annotative:  No`,
    );
    await bus.cancel();
  });
});

describe('MTEXT', () => {
  const contentsPrompt = (bus: PromptBus) => bus.prompt as StringPrompt;

  it('opens the editor on the box of two corners and takes its contents', async () => {
    const { bus, added } = setup();
    await bus.submit('MT');
    expect(bus.history.at(-1)).toBe(
      'Current text style:  "Standard"  Text height:  2.5000  Annotative:  No',
    );
    expect(bus.promptText).toBe('Specify first corner:');
    await bus.submit('10,50');
    expect(bus.promptText).toBe(
      'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
    );
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 10, y: 50 }, box: true } });
    await bus.submit('70,30');
    expect(contentsPrompt(bus)).toMatchObject({
      kind: 'string',
      spaces: true,
      editor: {
        kind: 'mtext',
        position: { x: 10, y: 50 },
        width: 60,
        height: 2.5,
        rotation: 0,
        attachment: 1,
        style: STANDARD,
      },
    });
    await bus.answer({ kind: 'string', value: '{\\LNote}\\Pline two', editor: true });
    expect(bus.command).toBeUndefined();
    const [e] = added();
    expect(e).toMatchObject({ type: 'MTEXT', owner: MODEL_SPACE, layer: LAYER_WALLS });
    expect(e!.geom).toMatchObject({
      kind: 'MTEXT',
      contents: '{\\LNote}\\Pline two',
      style: STANDARD,
      position: { x: 10, y: 50 },
      height: 2.5,
      width: 60,
      rotation: 0,
      attachment: 1,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    } satisfies Partial<MTextGeometry>);
  });

  it('puts the insertion point where the justification says on the box, whichever way it was dragged', async () => {
    const { bus } = setup();
    await bus.script(['MTEXT', '70,30', 'J']);
    expect(bus.promptText).toBe('Enter justification [TL/TC/TR/ML/MC/MR/BL/BC/BR] <TL>:');
    await bus.submit('BR');
    expect(bus.promptText).toBe(
      'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
    );
    await bus.submit('10,50');
    expect(contentsPrompt(bus).editor).toMatchObject({
      position: { x: 70, y: 30 },
      width: 60,
      attachment: 9,
    });
  });

  it('sets height, rotation, line spacing and style, and Width skips the second corner', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,0', 'H', '5', 'R', '90', 'L', 'E', '1.5x', 'S', 'Notes', 'W']);
    expect(bus.promptText).toBe('Specify width:');
    await bus.submit('40');
    await bus.answer({ kind: 'string', value: 'up', editor: true });
    expect(added()[0]!.geom).toMatchObject({
      position: { x: 0, y: 0 },
      height: 5,
      rotation: Math.PI / 2,
      width: 40,
      style: NOTES,
      lineSpacingStyle: 2,
      lineSpacing: 1.5,
    });
  });

  it('measures the width along the rotated text', async () => {
    const { bus } = setup();
    await bus.script(['MTEXT', '0,0', 'R', '90', '-10,30']);
    const ed = contentsPrompt(bus).editor!;
    expect(near(ed.width)).toBe(30);
    // In the text's frame x runs along +Y and up along −X, so (−10, 30) is above and to the
    // right of the first corner: the box's top-left is (−10, 0).
    expect([near(ed.position.x), near(ed.position.y)]).toEqual([-10, 0]);
  });

  it('joins lines typed on the command line as paragraphs until an empty one', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,10', '30,0', 'first', 'second {x}', '']);
    expect((added()[0]!.geom as MTextGeometry).contents).toBe('first\\Psecond {x}');
  });

  it('takes a line spacing distance as a factor of single spacing, and refuses nonsense', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,0', 'L', '', 'abc']);
    expect(bus.history.at(-1)).toBe('Requires a positive number or a factor such as 1.5x.');
    await bus.script(['8.3333333333', '10,-10', 'x', '']);
    expect((added()[0]!.geom as MTextGeometry).lineSpacing).toBeCloseTo(2, 6);
    expect((added()[0]!.geom as MTextGeometry).lineSpacingStyle).toBe(1);
  });

  it('opens no editor as -MTEXT', async () => {
    const { bus } = setup();
    await bus.script(['-MTEXT', '0,10', '30,0']);
    expect(contentsPrompt(bus).editor).toBeUndefined();
  });

  it('says so in a drawing without text styles', async () => {
    const model = DocumentModel.create(sampleInit());
    const bus = new PromptBus({ model, registry: builtinCommands() });
    await bus.submit('MTEXT');
    expect(bus.history.at(-1)).toBe('The drawing has no text style.');
    await bus.submit('TEXT');
    expect(bus.history.at(-1)).toBe('The drawing has no text style.');
    expect(bus.command).toBeUndefined();
  });

  it('makes nothing from empty contents', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,10', '30,0']);
    await bus.answer({ kind: 'string', value: '', editor: true });
    expect(bus.command).toBeUndefined();
    expect(added()).toEqual([]);
  });
});

describe('MTEXT columns (M2-07 part 3)', () => {
  const editorOf = (bus: PromptBus) => (bus.prompt as StringPrompt).editor!;

  it('asks for static columns: total width, number, gutter and height', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,50', 'C']);
    expect(bus.promptText).toBe('Enter column type [Dynamic/Static/No columns] <Dynamic>:');
    await bus.submit('S');
    expect(bus.promptText).toBe('Specify total width <42.5000>:');
    await bus.submit('100');
    expect(bus.promptText).toBe('Specify number of columns <2>:');
    await bus.submit('3');
    // The gutter's default is five times the text height (AutoCAD's Column Settings).
    expect(bus.promptText).toBe('Specify gutter width <12.5000>:');
    await bus.submit('5');
    expect(bus.promptText).toBe('Specify column height <62.5000>:');
    await bus.submit('40');
    expect(editorOf(bus)).toMatchObject({
      width: 30,
      columns: { type: 1, count: 3, width: 30, gutter: 5, height: 40 },
    });
    await bus.answer({ kind: 'string', value: 'a\\Nb', editor: true });
    expect(added()[0]!.geom).toMatchObject({
      width: 30,
      definedHeight: 40,
      columns: {
        type: 1,
        count: 3,
        flowReversed: false,
        autoHeight: false,
        width: 30,
        gutter: 5,
        heights: [],
      },
    } satisfies Partial<MTextGeometry>);
  });

  it('asks for dynamic columns and takes the count the editor found', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,50', 'C', '', '20', '', '30']);
    expect(editorOf(bus).columns).toEqual({
      type: 2,
      count: 1,
      width: 20,
      gutter: 12.5,
      height: 30,
    });
    await bus.answer({
      kind: 'string',
      value: 'long text',
      editor: true,
      columns: { type: 2, count: 4, width: 20, gutter: 12.5, height: 30 },
    });
    expect(added()[0]!.geom).toMatchObject({
      width: 20,
      definedHeight: 30,
      columns: { type: 2, count: 4, autoHeight: true, width: 20, gutter: 12.5, heights: [] },
    });
  });

  it('counts the column breaks of dynamic columns typed on the command line', async () => {
    const { bus, added } = setup();
    await bus.script(['-MTEXT', '0,50', 'C', 'D', '20', '5', '30', 'a\\Nb\\\\N\\Nc', '']);
    expect((added()[0]!.geom as MTextGeometry).columns?.count).toBe(3);
  });

  it('remembers the settings as the next defaults, and No columns makes none', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,50', 'C', 'S', '60', '2', '4', '25']);
    await bus.cancel();
    await bus.script(['MTEXT', '0,50', 'C']);
    expect(bus.promptText).toBe('Enter column type [Dynamic/Static/No columns] <Static>:');
    await bus.script(['N']);
    expect(bus.promptText).toBe(
      'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
    );
    await bus.submit('30,0');
    expect(editorOf(bus).columns).toBeUndefined();
    await bus.answer({ kind: 'string', value: 'x', editor: true });
    expect((added()[0]!.geom as MTextGeometry).columns).toBeUndefined();
  });

  it('refuses columns that do not fit the total width', async () => {
    const { bus } = setup();
    await bus.script(['MTEXT', '0,50', 'C', 'S', '10', '3', '5']);
    expect(bus.history.at(-1)).toBe('The gutters leave no room for the columns.');
    expect(bus.promptText).toBe('Specify gutter width <12.5000>:');
  });

  it('lets the editor add or drop columns', async () => {
    const { bus, added } = setup();
    await bus.script(['MTEXT', '0,50', '40,0']);
    await bus.answer({
      kind: 'string',
      value: 'x',
      editor: true,
      columns: { type: 1, count: 2, width: 15, gutter: 10, height: 50 },
    });
    expect(added()[0]!.geom).toMatchObject({
      width: 15,
      definedHeight: 50,
      columns: { type: 1, count: 2 },
    });
  });
});
