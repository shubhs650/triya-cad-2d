// M2-42: the system variables the app keeps, as SETVAR reads and sets them through the view
// host: the status bar's drafting aids and the per-user settings are the same settings.
import { describe, expect, it } from 'vitest';
import { APP_VARIABLES, DRAWING_VARIABLES, OSNAP } from '@triya/engine';
import { answerView } from '../src/canvas/view-host';
import { Drafting } from '../src/drafting';
import { drawingVariableReply, systemVariableReply } from '../src/system-variables';

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

  it('keep QPMODE and QPLOCATION, the status bar\u2019s Quick Properties button turning QPMODE\u2019s sign', () => {
    // AutoCAD 2024 Help, "QPMODE": −1 initially; 0 off, 1 all objects, 2 only objects with
    // Quick Properties; a negative value is off and keeps what it turns back on to.
    const d = new Drafting();
    expect(systemVariableReply(d, 'QPMODE')).toEqual({ ok: true, value: -1 });
    expect(d.isOn('qp')).toBe(false);
    d.toggle('qp');
    expect(systemVariableReply(d, 'QPMODE')).toEqual({ ok: true, value: 1 });
    systemVariableReply(d, 'QPMODE', 2);
    d.toggle('qp');
    expect(d.get().qpmode).toBe(-2);
    d.toggle('qp');
    expect(d.get().qpmode).toBe(2);
    // 0 is off with nothing to keep: the button turns it on for all objects.
    systemVariableReply(d, 'QPMODE', 0);
    expect(d.isOn('qp')).toBe(false);
    d.toggle('qp');
    expect(d.get().qpmode).toBe(1);
    expect(systemVariableReply(d, 'QPLOCATION')).toEqual({ ok: true, value: 0 });
    systemVariableReply(d, 'QPLOCATION', 1);
    expect(d.get().qpLocation).toBe(1);
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

describe('variables of the drawing the app answers (M2-59)', () => {
  // AutoCAD 2024 Help: DWGNAME the drawing's file name, DWGPREFIX its folder, DWGTITLED 1 once
  // the drawing has a name, DBMOD nonzero while it has changes no save holds.
  const doc = { name: 'plan.dxf', edits: 3, savedEdits: 3 };

  it('tells the file name, the folder a browser never reveals, and unsaved changes', () => {
    expect(drawingVariableReply(doc, 'DWGNAME')).toEqual({ ok: true, value: 'plan.dxf' });
    expect(drawingVariableReply(doc, 'DWGPREFIX')).toEqual({ ok: true, value: '' });
    expect(drawingVariableReply(doc, 'DWGTITLED')).toEqual({ ok: true, value: 1 });
    expect(drawingVariableReply(doc, 'DBMOD')).toEqual({ ok: true, value: 0 });
    expect(drawingVariableReply({ ...doc, edits: 4 }, 'DBMOD')).toEqual({ ok: true, value: 1 });
    // A drawing never saved under a name of its own.
    expect(drawingVariableReply({ ...doc, name: '' }, 'DWGNAME')).toEqual({
      ok: true,
      value: 'Drawing1.dxf',
    });
    expect(drawingVariableReply({ ...doc, name: '' }, 'DWGTITLED')).toEqual({ ok: true, value: 0 });
    expect(drawingVariableReply(doc, 'ORTHOMODE')).toBeUndefined();
  });

  it('answers every one the engine asks the app for that the drafting state does not keep', () => {
    const d = new Drafting();
    for (const v of DRAWING_VARIABLES) {
      expect(drawingVariableReply(doc, v.name), v.name).toMatchObject({ ok: true });
      expect(systemVariableReply(d, v.name), v.name).toMatchObject({ ok: false });
    }
  });
});
