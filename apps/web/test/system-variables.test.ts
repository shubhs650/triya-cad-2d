// M2-42: the system variables the app keeps, as SETVAR reads and sets them through the view
// host: the status bar's drafting aids and the per-user settings are the same settings.
import { describe, expect, it } from 'vitest';
import { APP_VARIABLES, DRAWING_VARIABLES, OSNAP } from '@triya/engine';
import { answerView } from '../src/canvas/view-host';
import { Drafting } from '../src/drafting';
import { DynMode } from '../src/dynamic-input';
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

  it('keeps the modify commands\u2019 options, OFFSETDIST and CHAMMODE only while the app runs (M3-12)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'OFFSETDIST')).toEqual({ ok: true, value: -1 });
    expect(systemVariableReply(d, 'TRIMEXTENDMODE')).toEqual({ ok: true, value: 1 });
    expect(systemVariableReply(d, 'PROJMODE')).toEqual({ ok: true, value: 1 });
    expect(systemVariableReply(d, 'OFFSETDIST', 2.5)).toEqual({ ok: true, value: 2.5 });
    expect(systemVariableReply(d, 'CHAMMODE', 1)).toEqual({ ok: true, value: 1 });
    expect(systemVariableReply(d, 'OFFSETGAPTYPE', 2)).toEqual({ ok: true, value: 2 });
    expect(d.get().modifyOptions.OFFSETGAPTYPE).toBe(2);
    // The unsaved ones are not the per-user settings.
    expect(d.get().modifyOptions).not.toHaveProperty('OFFSETDIST');
    expect(d.get().sessionOptions).toEqual({ OFFSETDIST: 2.5, CHAMMODE: 1 });
    // Setting what it holds changes nothing.
    const before = d.get();
    systemVariableReply(d, 'OFFSETGAPTYPE', 2);
    expect(d.get()).toBe(before);
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

  it('keep ROLLOVERTIPS, on at first (M2-35 part 21)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'ROLLOVERTIPS')).toEqual({ ok: true, value: 1 });
    systemVariableReply(d, 'ROLLOVERTIPS', 0);
    expect(d.get().rolloverTips).toBe(false);
    expect(systemVariableReply(d, 'ROLLOVERTIPS')).toEqual({ ok: true, value: 0 });
  });

  it('keep AUTOSNAP’s bits, POLAR and OTRACK being the status bar’s buttons (M2-59)', () => {
    // AutoCAD 2024 Help, "AUTOSNAP": 1 marker, 2 SnapTip, 4 magnet, 8 polar tracking, 16
    // object snap tracking, 32 tooltips for polar and object snap tracking; initially 63.
    const d = new Drafting();
    expect(systemVariableReply(d, 'AUTOSNAP')).toEqual({ ok: true, value: 63 });
    expect(systemVariableReply(d, 'AUTOSNAP', 1 | 4 | 16)).toEqual({ ok: true, value: 21 });
    expect(d.isOn('polar')).toBe(false);
    expect(d.isOn('otrack')).toBe(true);
    expect(d.get().autosnap).toBe(1 | 4);
    // F10 turns bit 8 back on; ORTHO on turns it off as POLAR's button does.
    d.toggle('polar');
    expect(systemVariableReply(d, 'AUTOSNAP')).toEqual({ ok: true, value: 29 });
    systemVariableReply(d, 'ORTHOMODE', 1);
    expect(systemVariableReply(d, 'AUTOSNAP')).toEqual({ ok: true, value: 21 });
    // Polar tracking set on turns ORTHO off, as F10 does.
    systemVariableReply(d, 'AUTOSNAP', 63);
    expect(d.isOn('ortho')).toBe(false);
    expect(d.isOn('polar')).toBe(true);
  });

  it('keep GRIPSIZE, the grip box size in Settings (M2-59 part 3)', () => {
    const d = new Drafting();
    // AutoCAD's initial 5.
    expect(systemVariableReply(d, 'GRIPSIZE')).toEqual({ ok: true, value: 5 });
    expect(systemVariableReply(d, 'GRIPSIZE', 9)).toEqual({ ok: true, value: 9 });
    expect(d.get().gripSize).toBe(9);
  });

  it('keep AUTOSNAPSIZE, DYNMODE and PICKFIRST (M2-59)', () => {
    const d = new Drafting();
    const dyn = new DynMode();
    expect(systemVariableReply(d, 'AUTOSNAPSIZE', undefined, dyn)).toEqual({ ok: true, value: 5 });
    systemVariableReply(d, 'AUTOSNAPSIZE', 12, dyn);
    expect(d.get().markerSize).toBe(12);
    // DYNMODE: 3, pointer and dimensional input, while F12 has it on; −3 while off. Since M3-06
    // part 4 its bits are the Dynamic Input tab's: 1 pointer input alone, 2 dimension input.
    expect(systemVariableReply(d, 'DYNMODE', undefined, dyn)).toEqual({ ok: true, value: 3 });
    expect(systemVariableReply(d, 'DYNMODE', -3, dyn)).toEqual({ ok: true, value: -3 });
    expect(dyn.get()).toBe(false);
    expect(systemVariableReply(d, 'DYNMODE', 1, dyn)).toEqual({ ok: true, value: 1 });
    expect(dyn.get()).toBe(true);
    expect(d.get().dynBits).toBe(1);
    // 0 turns it all off, keeping the bits F12 turns back on; −2 off with dimension input only.
    expect(systemVariableReply(d, 'DYNMODE', 0, dyn)).toEqual({ ok: true, value: -1 });
    expect(dyn.get()).toBe(false);
    expect(systemVariableReply(d, 'DYNMODE', -2, dyn)).toEqual({ ok: true, value: -2 });
    expect(d.get().dynBits).toBe(2);
    dyn.toggle();
    expect(systemVariableReply(d, 'DYNMODE', undefined, dyn)).toEqual({ ok: true, value: 2 });
    // PICKFIRST: AutoCAD's initial 1.
    expect(systemVariableReply(d, 'PICKFIRST', undefined, dyn)).toEqual({ ok: true, value: 1 });
    systemVariableReply(d, 'PICKFIRST', 0, dyn);
    expect(d.get().pickfirst).toBe(false);
  });

  it('keep DYNPROMPT, DYNPICOORDS and DYNPIFORMAT, the Dynamic Input tab (M3-06 part 4)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'DYNPROMPT')).toEqual({ ok: true, value: 1 });
    expect(systemVariableReply(d, 'DYNPROMPT', 0)).toEqual({ ok: true, value: 0 });
    expect(d.get().dynPrompt).toBe(false);
    expect(systemVariableReply(d, 'DYNPICOORDS')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'DYNPICOORDS', 1)).toEqual({ ok: true, value: 1 });
    expect(d.get().dynPiCoords).toBe(1);
    expect(systemVariableReply(d, 'DYNPIFORMAT')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'DYNPIFORMAT', 1)).toEqual({ ok: true, value: 1 });
    expect(d.get().dynPiFormat).toBe(1);
  });

  it('keep POLARMODE and POLARADDANG, the polar tracking settings (M3-06 part 1)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'POLARMODE')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'POLARMODE', 6)).toEqual({ ok: true, value: 6 });
    expect(d.get().polarMode).toBe(6);
    expect(systemVariableReply(d, 'POLARADDANG')).toEqual({ ok: true, value: '' });
    // Written back as decimal degrees, without the spaces typed.
    expect(systemVariableReply(d, 'POLARADDANG', ' 12.50 ; 80')).toEqual({
      ok: true,
      value: '12.5;80',
    });
    const refused = systemVariableReply(d, 'POLARADDANG', '12;north');
    expect(refused).toEqual({
      ok: false,
      message: 'Requires up to 10 angles in degrees separated by semicolons.',
    });
    expect(systemVariableReply(d, 'POLARADDANG', '1;2;3;4;5;6;7;8;9;10;11')).toMatchObject({
      ok: false,
    });
    expect(d.get().polarAddAngles).toBe('12.5;80');
    expect(systemVariableReply(d, 'POLARADDANG', '')).toEqual({ ok: true, value: '' });
    // Text is not a number variable's value.
    expect(systemVariableReply(d, 'POLARMODE', '2')).toEqual({
      ok: false,
      message: 'POLARMODE takes a number.',
    });
  });

  it('keep SNAPTYPE and POLARDIST, PolarSnap’s settings (M3-06 part 3)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'SNAPTYPE')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'POLARDIST')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'SNAPTYPE', 1)).toEqual({ ok: true, value: 1 });
    expect(systemVariableReply(d, 'POLARDIST', 2.5)).toEqual({ ok: true, value: 2.5 });
    expect(d.get()).toMatchObject({ snapType: 1, polarDist: 2.5 });
    systemVariableReply(d, 'SNAPTYPE', 0);
    expect(d.get().snapType).toBe(0);
  });

  it('keeps GRIDSTYLE, the dotted grid’s bits, lines everywhere at first (M3-06 part 6)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'GRIDSTYLE')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'GRIDSTYLE', 5)).toEqual({ ok: true, value: 5 });
    expect(d.get().gridStyle).toBe(5);
  });

  it('keeps TEMPOVERRIDES, the temporary override keys on (M3-06 part 5)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'TEMPOVERRIDES')).toEqual({ ok: true, value: 1 });
    expect(systemVariableReply(d, 'TEMPOVERRIDES', 0)).toEqual({ ok: true, value: 0 });
    expect(d.get().tempOverrides).toBe(false);
  });

  it('keep SELECTSIMILARMODE and SELECTIONCYCLING (M3-04 part 3)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'SELECTSIMILARMODE')).toEqual({ ok: true, value: 130 });
    expect(systemVariableReply(d, 'SELECTSIMILARMODE', 1)).toEqual({ ok: true, value: 1 });
    expect(d.get().selectSimilarMode).toBe(1);
    expect(systemVariableReply(d, 'SELECTIONCYCLING')).toEqual({ ok: true, value: 0 });
    systemVariableReply(d, 'SELECTIONCYCLING', 2);
    expect(d.isOn('sc')).toBe(true);
  });

  it('keep PICKSTYLE, whose bit 1 is group selection (M3-08)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'PICKSTYLE')).toEqual({ ok: true, value: 1 });
    expect(d.isOn('groups')).toBe(true);
    expect(systemVariableReply(d, 'PICKSTYLE', 2)).toEqual({ ok: true, value: 2 });
    expect(d.isOn('groups')).toBe(false);
  });

  it('keep GROUPDISPLAYMODE, which the Group Bounding Box toggle switches (M3-13)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'GROUPDISPLAYMODE')).toEqual({ ok: true, value: 2 });
    expect(d.isOn('groupBox')).toBe(true);
    expect(systemVariableReply(d, 'GROUPDISPLAYMODE', 0)).toEqual({ ok: true, value: 0 });
    expect(d.isOn('groupBox')).toBe(false);
    d.toggle('groupBox');
    expect(d.get().groupDisplayMode).toBe(2);
    d.toggle('groupBox');
    expect(d.get().groupDisplayMode).toBe(1);
  });

  it('keep PICKBOX, PICKADD and PICKAUTO (M3-04 part 4)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'PICKBOX')).toEqual({ ok: true, value: 3 });
    expect(systemVariableReply(d, 'PICKADD')).toEqual({ ok: true, value: 2 });
    expect(systemVariableReply(d, 'PICKAUTO')).toEqual({ ok: true, value: 5 });
    systemVariableReply(d, 'PICKBOX', 8);
    systemVariableReply(d, 'PICKADD', 0);
    systemVariableReply(d, 'PICKAUTO', 1);
    expect(d.get()).toMatchObject({ pickbox: 8, pickadd: 0, pickauto: 1 });
  });

  it('keep SELECTIONPREVIEW and PREVIEWFILTER (M3-04 part 5)', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'SELECTIONPREVIEW')).toEqual({ ok: true, value: 3 });
    expect(systemVariableReply(d, 'PREVIEWFILTER')).toEqual({ ok: true, value: 3 });
    systemVariableReply(d, 'SELECTIONPREVIEW', 2);
    systemVariableReply(d, 'PREVIEWFILTER', 16);
    expect(d.get()).toMatchObject({ selectionPreview: 2, previewFilter: 16 });
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
