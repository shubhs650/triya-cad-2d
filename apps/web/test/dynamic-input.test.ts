// M2-02 part 2: Dynamic Input's fields turn what is typed at the cursor into the text the command
// line would send (AutoCAD 2024, DYNMODE 3, DYNPICOORDS 0).
import { prompts, type Prompt } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  dynBackspace,
  dynFor,
  dynLive,
  dynReplay,
  dynTab,
  dynText,
  dynType,
  dynTyped,
  type DynState,
} from '../src/dynamic-input';

const first = prompts.point({ message: 'Specify first point' });
const next = prompts.point({
  message: 'Specify next point or',
  rubberBand: { from: { x: 10, y: 10 } },
});
const corner = prompts.point({
  message: 'Specify opposite corner',
  rubberBand: { from: { x: 10, y: 10 }, box: true },
});
const cursor = { x: 13, y: 14 };

const typing = (p: Prompt, keys: string, s: DynState = dynFor(p)): DynState => {
  for (const k of keys)
    s = k === '\t' ? dynTab(s) : k === '\b' ? dynBackspace(s, p) : dynType(s, k);
  return s;
};
const sent = (p: Prompt, keys: string) => dynText(typing(p, keys), p, cursor);

describe('Dynamic Input fields', () => {
  it('shows X and Y at a first point, Distance and Angle with a rubber band', () => {
    expect(dynFor(first).fields.map((f) => f.label)).toEqual(['X', 'Y']);
    expect(dynFor(next).fields.map((f) => f.label)).toEqual(['Distance', 'Angle']);
    expect(dynFor(corner).kind).toBe('pointer');
    expect(dynFor(prompts.distance({ message: 'Specify radius' })).fields[0]!.label).toBe(
      'Distance',
    );
    expect(dynFor(prompts.angle({ message: 'Specify angle' })).fields[0]!.label).toBe('Angle');
    expect(dynFor(prompts.keyword({ message: 'Enter an option', options: ['A'] })).kind).toBe(
      'single',
    );
  });

  it('first point: absolute x,y; a comma moves to Y', () => {
    const s = typing(first, '0,5');
    expect(s.active).toBe(1);
    expect(s.fields.map((f) => f.text)).toEqual(['0', '5']);
    expect(dynText(s, first, cursor)).toBe('0,5');
    expect(sent(first, '7')).toBe('7,14.0000');
    expect(sent(first, '@2,3')).toBe('@2,3');
  });

  it('next points: relative unless typed with #; the other field takes the cursor', () => {
    expect(sent(corner, '5,5')).toBe('@5,5');
    expect(sent(corner, '#5,5')).toBe('#5,5');
    expect(sent(corner, '\t4')).toBe('@3.0000,4');
  });

  it('dimension input: distance alone is direct distance; < or Tab moves to the angle', () => {
    expect(sent(next, '100')).toBe('100');
    expect(sent(next, '100<45')).toBe('@100<45');
    const tabbed = typing(next, '100\t45');
    expect(tabbed.fields[0]).toMatchObject({ text: '100', locked: true });
    expect(dynText(tabbed, next, cursor)).toBe('@100<45');
    expect(sent(next, '\t90')).toBe('@5.0000<90');
  });

  it('takes anything that is not a number as typed', () => {
    expect(sent(next, '@100<45')).toBe('@100<45');
    expect(sent(next, 'C')).toBe('C');
    expect(sent(first, "'Z")).toBe("'Z");
    expect(sent(first, '1,b')).toBe('1,b');
    expect(sent(next, '10<x')).toBe('10<x');
    expect(sent(first, '1.5e')).toBe('1.5e');
  });

  it('sends Enter with nothing typed', () => {
    expect(sent(first, '')).toBe('');
    expect(sent(next, '')).toBe('');
    expect(dynTyped(dynFor(first))).toBe(false);
  });

  it('Backspace deletes, unlocks an emptied field and goes back from an empty one', () => {
    let s = typing(next, '12\t');
    expect(s.active).toBe(1);
    s = dynBackspace(s, next);
    expect(s.active).toBe(0);
    s = typing(next, '\b\b', s);
    expect(s.fields[0]).toEqual({ label: 'Distance', text: '', locked: false });
    expect(typing(next, 'Cx\b').fields[0]!.text).toBe('C');
    expect(typing(next, 'C\b')).toEqual(dynFor(next));
    expect(dynTab(typing(next, 'C')).active).toBe(0);
  });

  it("shows the cursor's coordinates, distance and angle while nothing is typed", () => {
    expect(dynLive(dynFor(first), first, cursor)).toEqual(['13.0000', '14.0000']);
    expect(dynLive(dynFor(corner), corner, cursor)).toEqual(['3.0000', '4.0000']);
    expect(dynLive(dynFor(next), next, cursor)).toEqual(['5.0000', '53.1301']);
    expect(dynLive(dynFor(next), next, { x: 10, y: 5 })).toEqual(['5.0000', '270.0000']);
    const radius = prompts.distance({ message: 'Specify radius', base: { x: 0, y: 0 } });
    expect(dynLive(dynFor(radius), radius, { x: 3, y: 4 })).toEqual(['5.0000']);
    const angle = prompts.angle({ message: 'Specify angle', base: { x: 0, y: 0 } });
    expect(dynLive(dynFor(angle), angle, { x: 0, y: 4 })).toEqual(['90.0000']);
    expect(dynLive(dynFor(angle), prompts.angle({ message: 'a' }), cursor)).toEqual(['']);
    expect(dynLive(dynFor(first), first, undefined)).toEqual(['', '']);
  });

  it('carries keys typed ahead of a prompt over to it', () => {
    const s = dynReplay(next, ['1', '0', 'Tab', '4', '5', 'Backspace']);
    expect(s.fields.map((f) => [f.text, f.locked])).toEqual([
      ['10', true],
      ['4', false],
    ]);
    expect(dynReplay(first, [])).toEqual(dynFor(first));
  });
});
