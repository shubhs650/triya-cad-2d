// Triya stand-in for FreeCAD's Base/Console.h (MIT, Triya CAD 2D). PlaneGCS only writes
// debug and profiling logs through it; the WASM module has no console to write to, so every
// call is a no-op. Keeping the calls (rather than patching them out of GCS.cpp) leaves the
// vendored sources byte-identical to upstream.
#ifndef TRIYA_PLANEGCS_BASE_CONSOLE_H
#define TRIYA_PLANEGCS_BASE_CONSOLE_H

namespace Base
{
class ConsoleSingleton
{
public:
    template<typename... Args>
    void log(Args&&...)
    {}
    template<typename... Args>
    void warning(Args&&...)
    {}
    template<typename... Args>
    void error(Args&&...)
    {}
};

inline ConsoleSingleton& Console()
{
    static ConsoleSingleton console;
    return console;
}
}  // namespace Base

#endif
