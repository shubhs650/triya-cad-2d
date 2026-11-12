// M2-42: the system variables the app keeps, as SETVAR reads and sets them through the view
// host: the status bar's drafting aids and the per-user settings are the same settings.
import { describe, expect, it } from 'vitest';
import { APP_VARIABLES, OSNAP } from '@triya/engine';
import { answerView } from '../src/canvas/view-host';
import { Drafting } from '../src/drafting';
import { systemVariableReply } from '../src/system-variables';

describe('system variables the app keeps', () => {
  it('reads and sets every one SETVAR asks the app for', () => {
    const d = new Drafting();
    for (const v of APP_VARIABLES) {
      expect(systemVariableReply(d, v.name), v.name).toMatchObject({ ok: true });
    }
    expect(systemVariableReply(d, 'NOSUCH')).toEqual({
      ok: false,
      message: 'The app keeps no variable NOSUCH.',
    });
  });

  it('turns the status bar toggles, ORTHOMODE turning POLAR off as F8 does', () => {
    const d = new Drafting();
    expect(d.isOn('polar')).toBe(true);
    expect(systemVariableReply(d, 'ORTHOMODE')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'ORTHOMODE', 1)).toEqual({ ok: true, value: 1 });
    expect(d.isOn('ortho')).toBe(true);
    expect(d.isOn('polar')).toBe(false);
    // Setting what it holds changes nothing.
    systemVariableReply(d, 'ORTHOMODE', 1);
    expect(d.isOn('ortho')).toBe(true);
    systemVariableReply(d, 'GRIDMODE', 1);
    expect(d.isOn('grid')).toBe(true);
    // LWDISPLAY follows the drawing's own until it is set.
    d.setDrawingLineweights(true);
    expect(systemVariableReply(d, 'LWDISPLAY')).toEqual({ ok: true, value: 1 });
    systemVariableReply(d, 'LWDISPLAY', 0);
    expect(d.isOn('lwt')).toBe(false);
  });

  it('sets the values Settings keeps', () => {
    const d = new Drafting();
    systemVariableReply(d, 'OSMODE', OSNAP.MID);
    expect(d.get().osmode).toBe(OSNAP.MID);
    systemVariableReply(d, 'POLARANG', 45);
    expect(d.get().polarAngle).toBe(45);
    systemVariableReply(d, 'APERTURE', 20);
    expect(d.get().aperture).toBe(20);
    expect(systemVariableReply(d, 'REVCLOUDGRIPS')).toEqual({ ok: true, value: 1 });
    systemVariableReply(d, 'REVCLOUDGRIPS', 0);
    expect(d.get().revcloudGrips).toBe(false);
  });

  it('are answered by the view host, refused where the app keeps none', () => {
    const d = new Drafting();
    const ctx = { target: undefined, all: () => [], views: () => [] };
    expect(answerView({ op: 'sysvar', name: 'SNAPMODE' }, ctx)).toEqual({
      ok: false,
      message: 'There are no settings here.',
    });
    const reply = answerView(
      { op: 'sysvar', name: 'SNAPMODE', value: 1 },
      { ...ctx, sysvar: (name, value) => systemVariableReply(d, name, value) },
    );
    expect(reply).toEqual({ ok: true, value: 1 });
    expect(d.isOn('snap')).toBe(true);
  });
});
