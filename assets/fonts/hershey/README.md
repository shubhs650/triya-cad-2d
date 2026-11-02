# Hershey font data

`hershey.jhf` is the original Hershey occidental glyph set (1,597 glyphs) in James Hurt's
format, as distributed on USENET and mirrored by Paul Bourke
(https://paulbourke.net/dataformats/hershey/, `hershey.zip`, file `hershey`), unchanged.
SHA-256 `f64628825b4bc40461cc8c7cd3868b9a765969c738fea7a541ccc17fb7f77ef9`.

`pnpm fonts:build` converts it into the bundled fonts `assets/fonts/oet-*.json` with the
catalog in `packages/text/src/hershey/catalog.ts` (M1-09, DEC-044). The accent marks, the
diameter sign and the character assignments past ASCII are ours (MIT).

## Distribution terms

This distribution of the Hershey Fonts may be used by anyone for any purpose, commercial or
otherwise, providing that:

1. The following acknowledgements must be distributed with the font data:
   - The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the
     U. S. National Bureau of Standards.
   - The format of the Font data in this distribution was originally created by
     James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821.
2. The font data in this distribution may be converted into any other format *EXCEPT* the
   format distributed by the U.S. NTIS (which organization holds the rights to the
   distribution and use of the font data in that particular format).
