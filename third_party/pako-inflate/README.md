# pako-inflate

A stand-in for [pako](https://github.com/nodeca/pako) that `utif` (UTIF.js) loads through the
`pako` override in the root `package.json`. UTIF.js only calls `pako.inflate` (Deflate TIFF
strips); this answers it with [fflate](https://github.com/101arrowz/fflate)'s `unzlibSync` (MIT),
so the app ships no Zlib-licensed code. See `ATTRIBUTION.md` and M1-19 part 2.
