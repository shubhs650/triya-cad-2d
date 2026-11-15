// M3-06 part 5: the temporary override keys (AutoCAD 2024 Help, "TEMPOVERRIDES (System
// Variable)", "Override Object Snap Settings"): held at a prompt for a point, a key turns a
// drafting aid the other way, or snaps to one mode only, until it is let go.
import { describe, expect, it } from 'vitest';
import { OSNAP, OSNAP_OFF, type Prompt } from '@triya/engine';
import { INITIAL_DRAFTING, type DraftingState } from '../src/drafting';
import { HeldOverrides, takesOverrides, withOverrides } from '../src/temp-overrides';

const d: DraftingState = {
  ...INITIAL_DRAFTING,
  osmode: OSNAP.END | OSNAP.INT,
  ortho: false,
  polar: true,
  otrack: true,
  snap: true,
};

describe('withOverrides', () => {
  it('changes nothing with no key held', () => {
    expect(withOverrides(d, [])).toBe(d);
  });

  it('turns ORTHO the other way, POLAR off with it as F8 does', () => {
    expect(withOverrides(d, ['ortho'])).toMatchObject({ ortho: true, polar: false });
    expect(withOverrides({ ...d, ortho: true, polar: false }, ['ortho'])).toMatchObject({
      ortho: false,
      polar: false,
    });
  });

  it('turns POLAR, OTRACK and OSNAP the other way', () => {
    expect(withOverrides(d, ['polar'])).toMatchObject({ polar: false, ortho: false });
    expect(withOverrides({ ...d, polar: false, ortho: true }, ['polar'])).toMatchObject({
      polar: true,
      ortho: false,
    });
    expect(withOverrides(d, ['otrack']).otrack).toBe(false);
    expect(withOverrides(d, ['osnap']).osmode).toBe(OSNAP.END | OSNAP.INT | OSNAP_OFF);
    expect(withOverrides({ ...d, osmode: OSNAP.MID | OSNAP_OFF }, ['osnap']).osmode).toBe(
      OSNAP.MID,
    );
  });

  it('disables every snap and tracking, or enforces the running object snaps', () => {
    expect(withOverrides(d, ['disable'])).toMatchObject({
      osmode: OSNAP.END | OSNAP.INT | OSNAP_OFF,
      polar: false,
      otrack: false,
      snap: false,
      ortho: false,
    });
    expect(withOverrides({ ...d, osmode: OSNAP.MID | OSNAP_OFF }, ['enforce']).osmode).toBe(
      OSNAP.MID,
    );
  });

  it('snaps to one mode only, whatever OSNAP says', () => {
    expect(withOverrides(d, ['END']).osmode).toBe(OSNAP.END);
    expect(withOverrides({ ...d, osmode: OSNAP_OFF }, ['MID']).osmode).toBe(OSNAP.MID);
    expect(withOverrides(d, ['CEN']).osmode).toBe(OSNAP.CEN);
  });
});

describe('takesOverrides', () => {
  const point = (more: object = {}): Prompt =>
    ({ kind: 'point', message: 'Specify next point:', ...more }) as Prompt;

  it('takes them at prompts for a point, a distance or an angle', () => {
    expect(takesOverrides(point())).toBe(true);
    expect(takesOverrides({ kind: 'distance', message: 'Radius:' } as Prompt)).toBe(true);
    expect(takesOverrides({ kind: 'angle', message: 'Angle:' } as Prompt)).toBe(true);
  });

  it('leaves them alone at Command:, an object pick or a selection window', () => {
    expect(takesOverrides(undefined)).toBe(false);
    expect(takesOverrides(point({ pickbox: true }))).toBe(false);
    expect(
      takesOverrides(point({ rubberBand: { from: { x: 0, y: 0 }, box: true, selection: 'auto' } })),
    ).toBe(false);
    expect(takesOverrides({ kind: 'string', message: 'Name:' } as Prompt)).toBe(false);
  });
});

describe('HeldOverrides', () => {
  it('tells its listeners when what is held changes', () => {
    const held = new HeldOverrides();
    let heard = 0;
    const off = held.subscribe(() => heard++);
    held.press('Shift', 'ortho');
    held.press('Shift', 'ortho');
    held.press('KeyM', 'MID');
    expect(held.active()).toEqual(['MID']);
    held.release('KeyX');
    held.release('KeyM');
    expect(held.active()).toEqual(['ortho']);
    held.clear();
    held.clear();
    expect(heard).toBe(4);
    off();
    held.press('Shift', 'ortho');
    expect(heard).toBe(4);
  });
});
