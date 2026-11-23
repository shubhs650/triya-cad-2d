// Triya stand-in (MIT, Triya CAD 2D): Constraints.cpp includes this Boost header but uses
// nothing from it. Boost (BSL-1.0) is not on Triya's license list, so it is not built in.
// Constraints.cpp calls assert() without including <cassert>; in FreeCAD it arrives through
// Boost's headers and the precompiled header, so this stand-in brings it the same way.
#pragma once
#include <cassert>
