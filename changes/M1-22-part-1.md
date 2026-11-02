- M1-22 part 1 (#83): the app shell. `apps/web` is a Vite + React app that opens DWG and DXF
  drawings from the file picker (Open, Ctrl+O), a drop on the window or the installed app's
  file handler, parses and maps them in an I/O worker (`openInWorker`), and shows each in its
  own document tab on the dark model canvas, with wheel zoom at the cursor, middle-button pan,
  middle double-click zoom extents, cursor coordinates in the status bar, and the OET home and
  Report issue links. A new offline test checks the app requests nothing outside its origin.
