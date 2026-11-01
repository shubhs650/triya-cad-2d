// .lin reader (M1-13), on files written here from the format AutoCAD documents.
import { describe, expect, it } from 'vitest';
import { parseLin } from '../../src/index';

const deg = (d: number) => (d * Math.PI) / 180;

describe('parseLin', () => {
  it('reads simple linetypes, skipping comments and blank lines', () => {
    const f = parseLin(
      [';; a comment', '', '*DASH2,Two dashes __ __ __', 'A,.5,-.25', '*DOTS', 'A,0,-.2'].join(
        '\r\n',
      ),
    );
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([]);
    expect(f.linetypes).toEqual([
      {
        name: 'DASH2',
        description: 'Two dashes __ __ __',
        elements: [{ length: 0.5 }, { length: -0.25 }],
      },
      { name: 'DOTS', description: '', elements: [{ length: 0 }, { length: -0.2 }] },
    ]);
  });

  it('attaches text to the element before it, with its keys and units', () => {
    const f = parseLin(
      [
        '*GASLINE,Gas ---- GAS ----',
        'A,.5,-.2,["G,AS",STANDARD,S=.1,R=0.0,X=-0.1,Y=-.05],-.25',
      ].join('\n'),
    );
    expect(f.errors).toEqual([]);
    expect(f.linetypes[0]!.elements).toEqual([
      { length: 0.5 },
      {
        length: -0.2,
        embed: {
          kind: 'text',
          text: 'G,AS',
          style: 'STANDARD',
          scale: 0.1,
          rotation: 0,
          rotationMode: 'relative',
          offset: { x: -0.1, y: -0.05 },
        },
      },
      { length: -0.25 },
    ]);
  });

  it('reads text without a style, and angles in degrees, radians and grads', () => {
    const f = parseLin(
      [
        '*T1',
        'A,1,-.5,["HW",U=90],-.5',
        '*T2',
        'A,1,-.5,["HW",A=1.5r],-.5',
        '*T3',
        'A,1,-.5,["HW",a=100g,s=2],-.5',
        '*T4',
        'A,1,-.5,["HW",R=45d],-.5',
      ].join('\n'),
    );
    expect(f.errors).toEqual([]);
    const embeds = f.linetypes.map((l) => l.elements[1]!.embed!);
    expect(embeds[0]).toMatchObject({ rotationMode: 'upright' });
    expect(embeds[0]!.rotation).toBeCloseTo(deg(90), 12);
    expect(embeds[0]).not.toHaveProperty('style');
    expect(embeds[1]).toMatchObject({ rotationMode: 'absolute', rotation: 1.5 });
    expect(embeds[2]).toMatchObject({ rotationMode: 'absolute', scale: 2 });
    expect(embeds[2]!.rotation).toBeCloseTo(deg(90), 12);
    expect(embeds[3]!.rotation).toBeCloseTo(deg(45), 12);
  });

  it('reads a shape, whose name and file are positional and mandatory', () => {
    const f = parseLin('*CAPLINE\nA,1.0,-0.25,[CAP,ep.shx,S=2,R=10,X=0.5],-1.0');
    expect(f.errors).toEqual([]);
    expect(f.linetypes[0]!.elements[1]!.embed).toMatchObject({
      kind: 'shape',
      shapeName: 'CAP',
      style: 'ep.shx',
      scale: 2,
      rotationMode: 'relative',
      offset: { x: 0.5, y: 0 },
    });
  });

  it('reports what it cannot read, by line, and keeps the rest', () => {
    const f = parseLin(
      [
        '*NOALIGN',
        'B,.5,-.25',
        '*GAPFIRST',
        'A,-.5,.25',
        '*ONE',
        'A,.5',
        '*EMBEDFIRST',
        'A,["X",STANDARD],.5,-.25',
        '*NOFILE',
        'A,.5,-.2,[CAP],-.2',
        '*BADKEY',
        'A,.5,-.2,["X",Q=1],-.2',
        '*BADNUM',
        'A,.5,-1/4',
        '*ORPHAN',
        '*OK',
        'A,.5,-.25',
        'A,.1,-.1',
        '*LAST',
      ].join('\n'),
    );
    expect(f.linetypes.map((l) => l.name)).toEqual(['OK']);
    expect(f.errors).toEqual([
      { line: 2, message: 'NOALIGN: alignment must be A, not "B"' },
      { line: 4, message: 'GAPFIRST: the first dash must be 0 or greater' },
      { line: 6, message: 'ONE: needs at least two dash specifications' },
      { line: 8, message: 'EMBEDFIRST: a text or shape must follow a dash or gap' },
      { line: 10, message: 'NOFILE: shape CAP needs a shape file' },
      { line: 12, message: 'BADKEY: unknown key Q=' },
      { line: 14, message: 'BADNUM: dash length "-1/4" is not a number' },
      { line: 15, message: '*ORPHAN has no pattern line' },
      { line: 18, message: 'pattern line without a *name line' },
      { line: 19, message: '*LAST has no pattern line' },
    ]);
  });

  it('warns about a description longer than the documented 47 characters', () => {
    const f = parseLin(`*LONG,${'x'.repeat(48)}\nA,.5,-.25`);
    expect(f.linetypes).toHaveLength(1);
    expect(f.warnings).toEqual([{ line: 1, message: 'description of LONG exceeds 47 characters' }]);
  });
});
