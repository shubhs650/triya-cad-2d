// M5-03 part 1: ATTDEF (the Attribute Definition dialog), -ATTDEF and ATTDISP on the PromptBus,
// as AutoCAD 2024's (AutoCAD Help, "ATTDEF (Command)", "Attribute Definition Dialog Box",
// "-ATTDEF (Command)", "ATTDISP (Command)", "ATTMODE (System Variable)"):
//   - -ATTDEF shows the current modes, toggles them (Invisible/Constant/Verify/Preset/Lock
//     position/Multiple lines), asks the tag, the prompt (not for a constant attribute) and the
//     default value ("Enter attribute value" for a constant one), then places the definition as
//     TEXT places its text; Enter at the start point puts it below the last definition;
//   - the dialog's modes, attribute, insertion point and text settings make the same definition;
//     Specify On-screen asks "Specify start point" once OK closes it; Align below previous
//     attribute definition takes the last definition's text settings and goes below it;
//   - ATTDISP sets ATTMODE (Normal 1, ON 2, OFF 0), one undo step;
//   - each definition is one undo step, with the tag in capitals and the modes in DXF 70 / 280.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  type AttdefGeometry,
  type AttdefSettings,
  type DialogRequest,
  type DocumentModel,
  type PromptAnswer,
} from '../../src/index';
import { r6, setup } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'attdefine' }>;

function setHeader(model: DocumentModel, name: string, value: number | string): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value);
  model.apply(b.build());
}

function drawing(variables?: Map<string, number>) {
  const t = setup([], variables ? { variables } : {});
  const attdefs = () =>
    t
      .space()
      .filter((e) => e.geom.kind === 'ATTDEF')
      .map((e) => e.geom as AttdefGeometry);
  const request = () => {
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('attdefine');
    return p!.dialog as Request;
  };
  /** The dialog closed by `action` with its settings changed by `patch`. */
  const close = (patch: Partial<AttdefSettings>, pick?: string, action = 'ok') =>
    t.bus.answer({
      kind: 'dialog',
      action,
      attdefine: { settings: { ...request().settings, ...patch }, ...(pick && { pick }) },
    } as PromptAnswer);
  return { ...t, attdefs, request, close };
}

const at = (g: AttdefGeometry) => [r6(g.position.x), r6(g.position.y)];

describe('-ATTDEF', () => {
  it('asks modes, tag, prompt and default, then places it as TEXT does', async () => {
    const t = drawing();
    await t.bus.submit('-ATTDEF');
    expect(t.log).toContain(
      'Current attribute modes: Invisible=N Constant=N Verify=N Preset=N Lock position=Y Annotative=N Multiple lines=N',
    );
    expect(t.bus.promptText).toBe(
      'Enter an option to change [Invisible/Constant/Verify/Preset/Lock position/Multiple lines] <done>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Enter attribute tag name:');
    await t.bus.submit('part no');
    expect(t.log).toContain('Invalid attribute tag name: it cannot contain spaces.');
    expect(t.bus.promptText).toBe('Enter attribute tag name:');
    await t.bus.submit('part_no');
    expect(t.bus.promptText).toBe('Enter attribute prompt:');
    await t.bus.submit('Part number');
    expect(t.bus.promptText).toBe('Enter default attribute value:');
    await t.bus.submit('P-100 A');
    expect(t.log).toContain(
      'Current text style:  "Standard"  Text height:  2.5000  Annotative:  No',
    );
    expect(t.bus.promptText).toBe('Specify start point of text or [Justify/Style]:');
    await t.bus.submit('10,20');
    expect(t.bus.promptText).toBe('Specify text height <2.5000>:');
    await t.bus.submit('3');
    expect(t.bus.promptText).toBe('Specify rotation angle of text <0>:');
    await t.bus.submit('90');
    expect(t.bus.promptText).toBe('Command:');
    const [g] = t.attdefs();
    expect(g).toMatchObject({
      tag: 'PART_NO',
      prompt: 'Part number',
      value: 'P-100 A',
      flags: 0,
      lockPosition: true,
      style: '16',
      height: 3,
      halign: 0,
      valign: 0,
    });
    expect(g!.mtext).toBeUndefined();
    expect(at(g!)).toEqual([10, 20]);
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 2));
    // One undo step.
    await t.bus.submit('U');
    expect(t.attdefs()).toHaveLength(0);
  });

  it('toggles modes, a constant one asking its value and no prompt', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', 'I', 'C', 'V', 'P', 'L']);
    expect(t.log.at(-1)).toBe(
      'Current attribute modes: Invisible=Y Constant=Y Verify=Y Preset=Y Lock position=N Annotative=N Multiple lines=N',
    );
    await t.bus.script(['', 'MAT']);
    expect(t.bus.promptText).toBe('Enter attribute value:');
    await t.bus.script(['Steel', '0,0', '2', '0']);
    const [g] = t.attdefs();
    // Constant leaves Verify and Preset out (AutoCAD greys them); no prompt is kept.
    expect(g).toMatchObject({ tag: 'MAT', prompt: '', value: 'Steel', flags: 1 | 2 });
    expect(g!.lockPosition).toBeUndefined();
    // The modes are kept for the next -ATTDEF.
    await t.bus.submit('-ATTDEF');
    expect(t.log.at(-1)).toContain('Invisible=Y Constant=Y');
  });

  it('takes Justify and Style, and a fixed-height style asks no height', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', '', 'T1', 'First', 'a', 'S', 'notes']);
    expect(t.bus.promptText).toBe('Specify start point of text or [Justify/Style]:');
    await t.bus.script(['J', 'MC']);
    expect(t.bus.promptText).toBe('Specify middle point of text:');
    await t.bus.submit('5,5');
    expect(t.bus.promptText).toBe('Specify rotation angle of text <0>:');
    await t.bus.submit('0');
    const [g] = t.attdefs();
    expect(g).toMatchObject({ style: '17', height: 3.5, halign: 1, valign: 2 });
    expect(g!.alignmentPoint).toEqual({ x: 5, y: 5 });
  });

  it('places the next definition below the last at Enter, with its text settings', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', '', 'A', 'a', '', '0,10', '2', '0']);
    await t.bus.script(['-ATTDEF', '', 'B', 'b', '', '']);
    expect(t.bus.promptText).toBe('Command:');
    const [a, b] = t.attdefs();
    expect(b!.height).toBe(2);
    expect(at(a!)).toEqual([0, 10]);
    // The next line: 5/3 of the height below, as TEXT's.
    expect(at(b!)).toEqual([0, r6(10 - (2 * 5) / 3)]);
  });

  it('makes a multiline attribute: its value an MTEXT, its width asked', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', 'M']);
    expect(t.log.at(-1)).toContain('Multiple lines=Y');
    await t.bus.script(['', 'NOTE', 'Note', 'line one\\Pline two', 'J']);
    // Align and Fit have no MTEXT attachment.
    expect(t.bus.promptText).toBe(
      'Enter an option [Left/Center/Right/Middle/TL/TC/TR/ML/MC/MR/BL/BC/BR]:',
    );
    await t.bus.script(['TL', '0,0', '2.5', '0']);
    expect(t.bus.promptText).toBe('Specify boundary width <0.0000>:');
    await t.bus.submit('40');
    const [g] = t.attdefs();
    expect(g!.value).toBe('line one\\Pline two');
    expect(g!.mtext).toMatchObject({
      kind: 'MTEXT',
      contents: 'line one\\Pline two',
      width: 40,
      height: 2.5,
      attachment: 1,
      style: '16',
    });
    expect(g!.mtext!.position).toEqual({ x: 0, y: 0 });
  });

  it('says so at Enter with no definition to go below; Align takes TEXTSIZE and both points', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', '', '', 'A', '', '', '']);
    expect(t.log).toContain('No attribute definition to align below.');
    expect(t.log).toContain('Invalid attribute tag name: it must hold at least one character.');
    await t.bus.script(['J', 'Align', '0,0']);
    expect(t.bus.promptText).toBe('Specify second endpoint of text baseline:');
    await t.bus.submit('0,10');
    expect(t.bus.promptText).toBe('Command:');
    const [g] = t.attdefs();
    expect(g).toMatchObject({ halign: 3, height: 2.5, prompt: '', value: '' });
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 2));
    // The next one below an Align: both baseline points move down.
    await t.bus.script(['-ATTDEF', '', 'B', '', '', '']);
    const [, b] = t.attdefs();
    expect(b!.halign).toBe(3);
    expect(r6(b!.alignmentPoint!.x)).toBe(r6((2.5 * 5) / 3));
  });

  it('a multiline definition below a Fit one is justified Left; ? lists the styles', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', '', 'A', '', '', 'J', 'Fit', '0,0', '10,0', '2']);
    expect(t.attdefs()[0]!.halign).toBe(5);
    await t.bus.script(['-ATTDEF', 'M', '', 'B', '', '', 'S', '?']);
    expect(t.log).toContain('  NOTES');
    await t.bus.script(['Standard', '', '0']);
    const [, b] = t.attdefs();
    expect(b).toMatchObject({ halign: 0, valign: 0, height: 2 });
    expect(b!.mtext).toMatchObject({ attachment: 7, width: 0 });
  });

  it('Esc at the tag ends it with nothing made', async () => {
    const t = drawing();
    await t.bus.script(['-ATTDEF', '']);
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    expect(t.attdefs()).toHaveLength(0);
  });
});

describe('ATTDEF: the Attribute Definition dialog', () => {
  it('opens with Lock position, Specify On-screen, Left, the current style and TEXTSIZE', async () => {
    const t = drawing();
    setHeader(t.model, '$TEXTSIZE', 1.8);
    await t.bus.submit('ATTDEF');
    const r = t.request();
    expect(r.settings).toEqual({
      invisible: false,
      constant: false,
      verify: false,
      preset: false,
      lockPosition: true,
      multiline: false,
      tag: '',
      prompt: '',
      value: '',
      pointOnScreen: true,
      point: { x: 0, y: 0 },
      justify: 'Left',
      style: 'Standard',
      height: 1.8,
      rotation: 0,
      width: 0,
      alignBelow: false,
    });
    expect(r.styles).toEqual([
      { name: 'NOTES', height: 3.5 },
      { name: 'Standard', height: 0 },
    ]);
    expect(r.canAlignBelow).toBe(false);
  });

  it('OK with Specify On-screen asks the start point, then makes the definition', async () => {
    const t = drawing();
    await t.bus.submit('ATT');
    await t.close({ tag: 'title', prompt: 'Title', value: 'Untitled', verify: true });
    expect(t.bus.promptText).toBe('Specify start point:');
    await t.bus.submit('20,30');
    expect(t.bus.promptText).toBe('Command:');
    const [g] = t.attdefs();
    expect(g).toMatchObject({ tag: 'TITLE', prompt: 'Title', value: 'Untitled', flags: 4 });
    expect(at(g!)).toEqual([20, 30]);
    await t.bus.submit('U');
    expect(t.attdefs()).toHaveLength(0);
  });

  it('takes the point, style, justification and rotation typed in the dialog', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({
      tag: 'X',
      pointOnScreen: false,
      point: { x: 3, y: 4 },
      justify: 'BR',
      style: 'NOTES',
      rotation: Math.PI / 6,
      preset: true,
      invisible: true,
    });
    expect(t.bus.promptText).toBe('Command:');
    const [g] = t.attdefs();
    expect(g).toMatchObject({ flags: 1 | 8, style: '17', height: 3.5, halign: 2, valign: 1 });
    expect(g!.alignmentPoint).toEqual({ x: 3, y: 4 });
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 6));
  });

  it('reopens saying why when the tag is empty or holds a space', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: '  ' });
    expect(t.request().note).toBe('Invalid tag: a tag must hold at least one character.');
    await t.close({ tag: 'A B' });
    expect(t.request().note).toBe('Invalid tag: a tag cannot contain spaces.');
    expect(t.request().settings.tag).toBe('A B');
    await t.bus.cancel();
    expect(t.attdefs()).toHaveLength(0);
  });

  it('picks the height, rotation and boundary width on screen, then opens again', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: 'A', multiline: true }, 'height', 'select');
    expect(t.bus.promptText).toBe('Specify text height <2.5000>:');
    await t.bus.submit('4');
    expect(t.request().settings.height).toBe(4);
    expect(t.request().settings.multiline).toBe(true);
    await t.close({}, 'rotation', 'select');
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('45');
    expect(r6(t.request().settings.rotation)).toBe(r6(Math.PI / 4));
    await t.close({}, 'width', 'select');
    expect(t.bus.promptText).toBe('Specify boundary width <0.0000>:');
    await t.bus.submit('25');
    expect(t.request().settings.width).toBe(25);
    // Esc at a pick keeps the field and opens the dialog again.
    await t.close({}, 'height', 'select');
    await t.bus.cancel();
    expect(t.request().settings.height).toBe(4);
  });

  it("opens the MTEXT editor on a multiline default value with '...'", async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: 'N', multiline: true, value: 'one' }, 'value', 'select');
    const p = t.bus.prompt as { kind: string; editor?: { kind: string } };
    expect(p.kind).toBe('string');
    expect(p.editor?.kind).toBe('mtext');
    await t.bus.answer({ kind: 'string', value: 'one\\Ptwo' });
    expect(t.request().settings.value).toBe('one\\Ptwo');
    await t.close({ pointOnScreen: false, point: { x: 1, y: 1 }, width: 30 });
    const [g] = t.attdefs();
    expect(g!.mtext).toMatchObject({ contents: 'one\\Ptwo', width: 30, attachment: 7 });
  });

  it('aligns the next definition below the last, with its text settings', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: 'A', pointOnScreen: false, point: { x: 0, y: 0 }, height: 3 });
    await t.bus.submit('ATTDEF');
    const r = t.request();
    expect(r.canAlignBelow).toBe(true);
    // The modes and text settings are those it closed with; the attribute fields are cleared.
    expect(r.settings).toMatchObject({ tag: '', prompt: '', value: '', height: 3 });
    await t.close({ tag: 'B', alignBelow: true, height: 9, style: 'NOTES' });
    expect(t.bus.promptText).toBe('Command:');
    const [, b] = t.attdefs();
    expect(b).toMatchObject({ height: 3, style: '16' });
    expect(at(b!)).toEqual([0, -5]);
  });

  it('asks both baseline points for Align and Fit', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: 'F', justify: 'Fit', pointOnScreen: false });
    expect(t.bus.promptText).toBe('Specify first endpoint of text baseline:');
    await t.bus.submit('0,0');
    expect(t.bus.promptText).toBe('Specify second endpoint of text baseline:');
    await t.bus.submit('10,0');
    const [g] = t.attdefs();
    expect(g).toMatchObject({ halign: 5, valign: 0 });
    expect(g!.alignmentPoint).toEqual({ x: 10, y: 0 });
  });

  it('reopens on a missing style, a multiline Fit, a zero height and a negative width', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: 'A', style: 'NONE' });
    expect(t.request().note).toBe('Cannot find text style "NONE".');
    await t.close({ style: 'Standard', multiline: true, justify: 'Fit' });
    expect(t.request().note).toBe('A multiline attribute cannot be justified Fit.');
    await t.close({ justify: 'Left', height: 0 });
    expect(t.request().note).toBe('Text height must be greater than 0.');
    await t.close({ height: 1, width: -1 });
    expect(t.request().note).toBe('Boundary width cannot be negative.');
    // A pick refused (0 high, negative width) keeps the field.
    await t.close({ width: 0 }, 'height', 'select');
    await t.bus.submit('0');
    expect(t.request().settings.height).toBe(1);
    await t.close({}, 'width', 'select');
    await t.bus.submit('-2');
    expect(t.request().settings.width).toBe(0);
    await t.close({}, 'rotation', 'select');
    await t.bus.cancel();
    expect(t.request().settings.rotation).toBe(0);
    await t.close({}, 'value', 'select');
    await t.bus.cancel();
    expect(t.request().settings.value).toBe('');
    // Settings the dialog cannot give end the command.
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      attdefine: { settings: {} },
    } as PromptAnswer);
    expect(t.bus.promptText).toBe('Command:');
  });

  it('Esc at the start point makes nothing; a fixed-height style keeps its height', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.close({ tag: 'A', style: 'NOTES', height: 9 });
    await t.bus.cancel();
    expect(t.attdefs()).toHaveLength(0);
    await t.bus.submit('ATTDEF');
    expect(t.request().settings.style).toBe('NOTES');
    await t.close({ tag: 'A', pointOnScreen: false, height: 9, multiline: true, alignBelow: true });
    const [g] = t.attdefs();
    expect(g).toMatchObject({ height: 3.5 });
    expect(g!.mtext).toBeDefined();
  });

  it('Cancel makes nothing', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    expect(t.attdefs()).toHaveLength(0);
  });
});

describe('ATTDISP', () => {
  it('sets ATTMODE: Normal 1, ON 2, OFF 0, the current one the default', async () => {
    const t = drawing();
    setHeader(t.model, '$ATTMODE', 1);
    await t.bus.submit('ATTDISP');
    expect(t.bus.promptText).toBe('Enter attribute visibility setting [Normal/ON/OFF] <Normal>:');
    await t.bus.submit('ON');
    expect(t.model.header.get('$ATTMODE')).toBe(2);
    await t.bus.submit('ATTDISP');
    expect(t.bus.promptText).toBe('Enter attribute visibility setting [Normal/ON/OFF] <ON>:');
    await t.bus.submit('OFF');
    expect(t.model.header.get('$ATTMODE')).toBe(0);
    await t.bus.submit('ATTDISP');
    await t.bus.submit('');
    expect(t.model.header.get('$ATTMODE')).toBe(0);
    // One undo step each.
    await t.bus.submit('U');
    expect(t.model.header.get('$ATTMODE')).toBe(2);
    await t.bus.submit('U');
    expect(t.model.header.get('$ATTMODE')).toBe(1);
  });

  it('reads a missing ATTMODE as Normal', async () => {
    const t = drawing();
    await t.bus.submit('ATTDISP');
    expect(t.bus.promptText).toBe('Enter attribute visibility setting [Normal/ON/OFF] <Normal>:');
    await t.bus.submit('N');
    expect(t.bus.promptText).toBe('Command:');
  });
});

describe('AFLAGS', () => {
  it('gives ATTDEF and -ATTDEF their modes, and keeps the ones they end with (M5-03 part 3)', async () => {
    // Invisible and Verify, as SETVAR or another session's ATTDEF left them.
    const variables = new Map([['AFLAGS', 1 | 4]]);
    const t = drawing(variables);
    await t.bus.submit('-ATTDEF');
    expect(t.log.at(-1)).toBe(
      'Current attribute modes: Invisible=Y Constant=N Verify=Y Preset=N Lock position=N Annotative=N Multiple lines=N',
    );
    // Each toggle sets it.
    await t.bus.script(['P', 'L']);
    expect(variables.get('AFLAGS')).toBe(1 | 4 | 8 | 16);
    await t.bus.cancel();

    await t.bus.submit('ATTDEF');
    expect(t.request().settings).toMatchObject({
      invisible: true,
      constant: false,
      verify: true,
      preset: true,
      lockPosition: true,
      multiline: false,
    });
    await t.close({ tag: 'A', invisible: false, multiline: true, pointOnScreen: false });
    expect(t.attdefs()).toHaveLength(1);
    expect(variables.get('AFLAGS')).toBe(4 | 8 | 16 | 32);

    // Set at the command line, the next dialog opens on it, over its last settings.
    await t.bus.script(['AFLAGS', '2']);
    expect(variables.get('AFLAGS')).toBe(2);
    await t.bus.submit('ATTDEF');
    expect(t.request().settings).toMatchObject({
      invisible: false,
      constant: true,
      verify: false,
      preset: false,
      lockPosition: false,
      multiline: false,
    });
  });
});
