// The fonts the app has loaded for drawing text (ARCHITECTURE.md §8). The health report
// (M1-70) reads which of a drawing's fonts they serve and which stand-in draws the rest.
// Nothing fills the book yet: the user font store is M1-37 and drawing text in the app with the
// bundled Hershey fonts comes with M1-41, which load into this same book, so until then the
// report truthfully says each font is not drawn.
import { FontBook } from '@triya/text';

export const appFonts = new FontBook();
