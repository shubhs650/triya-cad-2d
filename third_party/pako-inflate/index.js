// UTIF.js calls pako.inflate(bytes) for Deflate-compressed TIFF strips (TIFF compression 8,
// zlib-wrapped data) and nothing else. This stands in for pako, whose zlib port is under the
// Zlib license, which ATTRIBUTION.md's allowed list does not name; fflate is MIT.
'use strict';
const { unzlibSync } = require('fflate');

exports.inflate = (data) => unzlibSync(data);
