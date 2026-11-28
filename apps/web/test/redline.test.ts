// M7-07: the start screen's Open PDF (PRD FR-Z2): the PDF's first page attached by -PDFATTACH in a
// new drawing, then an offer to calibrate its scale with two picks (SCALE's Reference option on
// the underlay, as pdf-calibrate.spec.ts does it by hand). The answers go to the prompts they are
// meant for, matched by the prompt's message, so a prompt that differs stops the script instead
// of typing into it.
// M8-04: then the markup: calibrated or not, the drawing's current layer is REDLINE (red, made by
// -LAYER) and the card offers the markup commands and Plot until Done; calibrating zooms to the
// page at its new size first.
import type { CommandInput, CommandOutput, Entity, Prompt } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Redline, redlineDrawingName } from '../src/redline';

const prompt = (message: string): CommandOutput =>
  ({
    type: 'prompt',
    prompt: { kind: 'string', message } as unknown as Prompt,
    text: `${message}:`,
  }) as unknown as CommandOutput;

const underlayAdded = (id: number): CommandOutput =>
  ({
    type: 'change',
    change: {
      entities: {
        added: [
          {
            index: 0,
            entity: {
              id,
              geom: {
                kind: 'PDFUNDERLAY',
                position: { x: 0, y: 0 },
                scale: { x: 25.4, y: 25.4, z: 25.4 },
                rotation: 0,
              },
            } as unknown as Entity,
          },
        ],
      },
    },
  }) as unknown as CommandOutput;

const lineAdded: CommandOutput = {
  type: 'change',
  change: {
    entities: { added: [{ index: 1, entity: { id: 9, geom: { kind: 'LINE' } } as never }] },
  },
} as unknown as CommandOutput;

const underlayScaled = (id: number, scale: number): CommandOutput =>
  ({
    type: 'change',
    change: {
      entities: {
        updated: [
          {
            index: 0,
            after: {
              id,
              geom: {
                kind: 'PDFUNDERLAY',
                position: { x: 0, y: 0 },
                scale: { x: scale, y: scale, z: scale },
                rotation: 0,
              },
            } as unknown as Entity,
          },
        ],
      },
    },
  }) as unknown as CommandOutput;

/** -LAYER's prompts as Make, Color and the end ask them: what the red-line types at each. */
function typeLayerScript(r: Redline): string[] {
  const out: string[] = [];
  for (const m of [
    'Enter an option',
    'Enter name for new layer (becomes the current layer)',
    'Enter an option',
    'New color',
    'Enter name list of layer(s) for color 1 (red)',
    'Enter an option',
  ])
    out.push(...submits(r.output(1, prompt(m))));
  return out;
}

const end = (command: string, cancelled = false): CommandOutput => ({
  type: 'end',
  command,
  cancelled,
});

const submits = (inputs: readonly CommandInput[]) =>
  inputs.map((i) => (i.kind === 'submit' ? i.text : i.kind));

/** A red-line begun on drawing 1 and taken through -PDFATTACH, page 1 of plan.pdf attached. */
function attached(page?: { width: number; height: number }): { r: Redline; sent: string[] } {
  const r = new Redline();
  const sent = [...submits(r.begin(1, 'plan.pdf', page))];
  for (const o of [
    prompt('Path to PDF file to attach'),
    prompt('Enter page number or'),
    prompt('Specify insertion point'),
    prompt('Specify scale factor'),
    prompt('Specify rotation'),
    underlayAdded(42),
    end('PDFATTACH'),
  ])
    sent.push(...submits(r.output(1, o)));
  return { r, sent };
}

describe('Open PDF red-line flow', () => {
  it('attaches page 1 at the origin at its printed size, then zooms to it', () => {
    // A letter page, 8.5 x 11 in, 25.4 units an inch (a millimetre drawing): its frame and a
    // twentieth of it around, as ZOOM Window. Extents would miss the page until it is drawn.
    const { r, sent } = attached({ width: 8.5, height: 11 });
    expect(sent).toEqual([
      '-PDFATTACH',
      '"plan.pdf"',
      '',
      '0,0',
      '',
      '',
      'ZOOM',
      '-10.795,-13.97',
      '226.695,293.37',
    ]);
    expect(r.get(1)).toEqual({ phase: 'offer', file: 'plan.pdf' });
  });

  it("zooms to the drawing's extents when the page size is not known", () => {
    expect(attached().sent.slice(-2)).toEqual(['ZOOM', 'E']);
  });

  it('quotes nothing else and leaves other drawings alone', () => {
    const { r } = attached();
    expect(r.output(2, prompt('Specify insertion point'))).toEqual([]);
    expect(r.get(2)).toBeUndefined();
  });

  it('stops typing when a prompt is not the one expected', () => {
    const r = new Redline();
    r.begin(1, 'plan.pdf');
    expect(submits(r.output(1, prompt('Path to PDF file to attach')))).toEqual(['"plan.pdf"']);
    // The file was not found: Command: again, with nothing typed into it.
    expect(r.output(1, prompt('Command'))).toEqual([]);
    expect(r.output(1, end('PDFATTACH'))).toEqual([]);
    expect(r.get(1)).toEqual({
      phase: 'failed',
      file: 'plan.pdf',
      message: 'plan.pdf could not be attached: see the command line.',
    });
  });

  it('calibrates by SCALE Reference on the underlay, about its corner at the origin', () => {
    const { r } = attached({ width: 8.5, height: 11 });
    const sent = submits(r.calibrate(1));
    // Esc first: a preselection would skip "Select objects".
    expect(sent).toEqual(['cancel', 'SCALE']);
    expect(r.get(1)?.phase).toBe('calibrating');
    const answers: string[] = [];
    for (const o of [
      prompt('Select objects'),
      { type: 'selection', ids: [42] } as CommandOutput,
      prompt('Select objects'),
      prompt('Specify base point'),
      prompt('Specify scale factor or'),
    ])
      answers.push(...submits(r.output(1, o)));
    expect(answers).toEqual(['L', '', '0,0', 'R']);
    // The two picks and the true length are the drafter's: nothing is typed for them.
    expect(r.output(1, prompt('Specify reference length'))).toEqual([]);
    expect(r.output(1, prompt('Specify new length or'))).toEqual([]);
    expect(r.get(1)?.phase).toBe('calibrating');
    r.output(1, underlayScaled(42, 25));
    // SCALE ends: the REDLINE layer is made current, then the page is shown at its new size.
    expect(submits(r.output(1, end('SCALE')))).toEqual(['-LAYER']);
    expect(r.get(1)).toEqual({ phase: 'markup', file: 'plan.pdf', ready: false });
    expect(typeLayerScript(r)).toEqual(['M', 'REDLINE', 'C', '1', 'REDLINE', '']);
    // A letter page at 25 units an inch: 212.5 x 275, and a twentieth around.
    expect(submits(r.output(1, end('LAYER')))).toEqual([
      'ZOOM',
      '-10.625,-13.75',
      '223.125,288.75',
    ]);
    // Later commands' ends type nothing more.
    expect(r.output(1, end('ZOOM'))).toEqual([]);
    expect(r.get(1)).toEqual({ phase: 'markup', file: 'plan.pdf', ready: true });
  });

  it('offers calibrating again when SCALE is cancelled', () => {
    const { r } = attached();
    r.calibrate(1);
    r.output(1, prompt('Select objects'));
    r.output(1, { type: 'selection', ids: [42] } as CommandOutput);
    r.output(1, prompt('Select objects'));
    r.output(1, prompt('Specify base point'));
    r.output(1, prompt('Specify scale factor or'));
    r.output(1, prompt('Specify reference length'));
    r.output(1, end('SCALE', true));
    expect(r.get(1)).toEqual({ phase: 'offer', file: 'plan.pdf' });
  });

  it('cancels SCALE when Last is not the underlay', () => {
    const { r } = attached();
    r.calibrate(1);
    r.output(1, prompt('Select objects'));
    r.output(1, { type: 'selection', ids: [9] } as CommandOutput);
    expect(submits(r.output(1, prompt('Select objects')))).toEqual(['cancel']);
    r.output(1, end('SCALE', true));
    expect(r.get(1)).toEqual({
      phase: 'offer',
      file: 'plan.pdf',
      note: 'The PDF is no longer the last object drawn: select it for SCALE and use its Reference option.',
    });
  });

  it('withdraws the offer once the drawing is edited, or when closed', () => {
    const { r } = attached();
    r.output(1, lineAdded);
    expect(r.get(1)).toBeUndefined();
    const again = attached().r;
    again.dismiss(1);
    expect(again.get(1)).toBeUndefined();
    expect(again.calibrate(1)).toEqual([]);
    expect(again.skip(1)).toEqual([]);
  });

  it('Not now goes on to the markup on the REDLINE layer, at the printed size', () => {
    const { r } = attached({ width: 8.5, height: 11 });
    // Esc first, as for Calibrate: a command left running would take -LAYER as its answer.
    expect(submits(r.skip(1))).toEqual(['cancel', '-LAYER']);
    expect(r.get(1)).toEqual({ phase: 'markup', file: 'plan.pdf', ready: false });
    expect(typeLayerScript(r)).toEqual(['M', 'REDLINE', 'C', '1', 'REDLINE', '']);
    // The page was not scaled: it is shown already.
    expect(r.output(1, end('LAYER'))).toEqual([]);
    expect(r.get(1)).toEqual({ phase: 'markup', file: 'plan.pdf', ready: true });
    expect(r.calibrate(1)).toEqual([]);
  });

  it('keeps the markup card while the drafter draws, until Done', () => {
    const { r } = attached();
    r.skip(1);
    typeLayerScript(r);
    r.output(1, end('LAYER'));
    r.output(1, lineAdded);
    r.output(1, prompt('Specify first point'));
    expect(r.get(1)).toEqual({ phase: 'markup', file: 'plan.pdf', ready: true });
    r.dismiss(1);
    expect(r.get(1)).toBeUndefined();
  });

  it('stops typing the layer script when -LAYER asks something else', () => {
    const { r } = attached();
    r.skip(1);
    expect(submits(r.output(1, prompt('Enter an option')))).toEqual(['M']);
    // A drafter's command took over: nothing is typed into its prompts.
    expect(r.output(1, prompt('Specify start point'))).toEqual([]);
    expect(r.output(1, prompt('Enter an option'))).toEqual([]);
    expect(r.get(1)?.phase).toBe('markup');
  });

  it('tells its listeners when a drawing changes phase', () => {
    const r = new Redline();
    let heard = 0;
    const stop = r.subscribe(() => heard++);
    r.begin(1, 'plan.pdf');
    expect(heard).toBe(1);
    stop();
    r.dismiss(1);
    expect(heard).toBe(1);
  });
});

describe('redlineDrawingName', () => {
  it('names the drawing after the PDF, as a .dxf, unless that name is taken', () => {
    expect(redlineDrawingName('Vendor GA rev B.pdf', [], 'Drawing1.dxf')).toBe(
      'Vendor GA rev B.dxf',
    );
    expect(redlineDrawingName('plan.PDF', ['PLAN.dxf'], 'Drawing2.dxf')).toBe('Drawing2.dxf');
  });
});
