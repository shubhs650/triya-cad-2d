// The browser's side of Save and Save As (M2-13, save.ts): the I/O worker writes the DXF, the
// File System Access save picker or a download places it.
import IoWorker from '@triya/io/worker?worker';
import { saveInWorker } from '@triya/io/client';
import type { FolderHandle, PictureFilesEnv } from './picture-files';
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
    write: (bytes, changes) => saveInWorker(bytes, { changes, createWorker: () => new IoWorker() }),
    ...(picker && {
      pick: (suggestedName: string) =>
        picker.call(win, { suggestedName, types: [DXF_TYPE], excludeAcceptAllOption: true }),
    }),
    download: (name, bytes) => {
      const url = URL.createObjectURL(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/dxf' }),
      );
      const a = win.document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      // The click starts the download; the URL can go once it has.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

/** PNG, the one type a pasted picture is saved as (M2-72). */
const PNG_TYPE = { description: 'PNG image (*.png)', accept: { 'image/png': ['.png'] } };

interface FolderPickerWindow {
  showDirectoryPicker?(o: {
    id: string;
    mode: 'readwrite';
    startIn?: SaveHandle;
  }): Promise<FolderHandle>;
  showSaveFilePicker?(o: {
    suggestedName: string;
    types: (typeof PNG_TYPE)[];
    excludeAcceptAllOption: boolean;
    startIn?: SaveHandle;
  }): Promise<SaveHandle>;
}

/**
 * The browser's side of writing pasted pictures beside a drawing (M2-72, picture-files.ts): the
 * folder picker opened at the saved DXF, the save picker for one PNG, or downloads.
 */
export function browserPictureFiles(win: Window = window): PictureFilesEnv {
  const w = win as unknown as FolderPickerWindow;
  const folders = w.showDirectoryPicker;
  const files = w.showSaveFilePicker;
  return {
    ...(folders && {
      pickFolder: (startIn: SaveHandle | undefined) =>
        folders.call(win, { id: 'triya-pictures', mode: 'readwrite', ...(startIn && { startIn }) }),
    }),
    ...(files && {
      pickFile: (suggestedName: string, startIn: SaveHandle | undefined) =>
        files.call(win, {
          suggestedName,
          types: [PNG_TYPE],
          excludeAcceptAllOption: true,
          ...(startIn && { startIn }),
        }),
    }),
    download: (name, bytes) => {
      const url = URL.createObjectURL(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
      );
      const a = win.document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}
