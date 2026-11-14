// The offer a save makes when the drawing names pictures pasted from other apps (M2-72,
// picture-files.ts): a notice over the drawing with a button that asks for the drawing's folder
// (the save picker's gesture went to the DXF), or downloads the pictures. It stays until
// answered: Not now turns it down for these pictures.
import { useSyncExternalStore } from 'react';
import type { PictureFiles } from './picture-files';

export function PictureOfferNotice({
  pictures,
  onNote,
}: {
  pictures: PictureFiles;
  /** What came of the button, for the notice line. */
  onNote: (message: string) => void;
}) {
  const offer = useSyncExternalStore(pictures.subscribe, pictures.get);
  if (!offer) return null;
  const n = offer.pictures.length;
  const text =
    n === 1
      ? `${offer.drawing} shows a picture pasted from another app, kept only on this device: others see its frame unless the file goes with the drawing.`
      : `${offer.drawing} shows ${n} pictures pasted from other apps, kept only on this device: others see their frames unless the files go with the drawing.`;
  const them = n === 1 ? 'it' : 'them';
  return (
    <div className="notice picture-offer" role="group" aria-label="Pasted pictures">
      <span>{text}</span>
      <button
        type="button"
        onClick={() => void pictures.accept().then((note) => note && onNote(note))}
      >
        {offer.way === 'folder' ? `Save ${them} beside the drawing…` : `Download ${them}`}
      </button>
      <button type="button" onClick={() => pictures.decline()}>
        Not now
      </button>
    </div>
  );
}
