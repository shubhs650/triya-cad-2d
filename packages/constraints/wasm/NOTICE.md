# Third-party notice for the PlaneGCS module

`planegcs.wasm` and `planegcs.mjs` are a separate module, loaded at run time only when a sketch is solved. They are built from:

- **PlaneGCS**, the 2D geometric constraint solver of FreeCAD, © Konstantinos Poulios and the FreeCAD contributors, under the GNU Lesser General Public License version 2.1 or later. Source: https://github.com/FreeCAD/FreeCAD/tree/4fd3bf320d9566a27e60069fc8387448aaa3a094/src/Mod/Sketcher/App/planegcs, also in this repository at `third_party/planegcs/src`, with the build script (`third_party/planegcs/build.sh`) and Triya's patches, so you can rebuild the module, changed or not, and use it in place of this one.
- **Eigen** 3.4.0, under the Mozilla Public License 2.0. Source: https://gitlab.com/libeigen/eigen/-/tree/3.4.0.
- Triya CAD 2D's binding and stand-in headers (`third_party/planegcs/bindings`, `shim`), MIT.
- The Emscripten runtime, MIT.

The rest of Triya CAD 2D is MIT and does not include this module's code.
