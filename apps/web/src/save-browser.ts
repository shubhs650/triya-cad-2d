// The browser's side of Save and Save As (M2-13, save.ts): the I/O worker writes the DXF, the
// File System Access save picker or a download places it.
import IoWorker from '@triya/io/worker?worker';
import { saveInWorker } from '@triya/io/client';
import type { SaveEnv, SaveHandle } from './save';

/** AutoCAD 2018 DXF, the one type Save As offers (DEC-047). */
const DXF_TYPE = {
  description: 'AutoCAD 2018 DXF (*.dxf)',
  accept: { 'application/dxf': ['.dxf'] },
};

interface PickerWindow {
  showSaveFilePicker?(o: {
    suggestedName: string;
    types: (typeof DXF_TYPE)[];
    excludeAcceptAllOption: boolean;
  }): Promise<SaveHandle>;
}

/** The browser's save: the I/O worker writes, the save picker or a download places the file. */
export function browserSave(win: Window = window): SaveEnv {
  const picker = (win as unknown as PickerWindow).showSaveFilePicker;
  return {
    write: (bytes, changes) =>
      saveInWorker(bytes, { changes, createWorker: () => new IoWorker() }),
    ...(picker && {
      pick: (suggestedName: string) =>
        picker.call(win, { suggestedName, types: [DXF_TYPE], excludeAcceptAllOption: true }),
    }),
    download: (name, bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/dxf' }));
      const a = win.document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      // The click starts the download; the URL can go once it has.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}
