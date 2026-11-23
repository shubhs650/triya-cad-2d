// Triya CAD 2D's embind interface to PlaneGCS (MIT, Triya CAD 2D; linked into the LGPL-2.1+
// PlaneGCS WASM module). `@triya/constraints` (packages/constraints/src/planegcs.ts) is the
// only caller; keep the constraint codes below in step with `ConstraintKind` there.
//
// A Sketch owns its parameters (plain doubles; PlaneGCS works on pointers to them, so they
// live in deques, whose elements never move) and the points, lines, circles and arcs built
// from them. Each parameter is an unknown the solver may change, fixed (a Fix constraint or
// a driving dimension's value) or driven (a reference dimension's value, which the solver
// computes). Constraints carry a caller-chosen tag (>= 1), which is what diagnose() reports
// conflicting and redundant constraints by.
#include <deque>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "GCS.h"

namespace
{

enum ParamKind
{
    Unknown = 0,
    Fixed = 1,
    Driven = 2,
};

// Codes for Sketch::addConstraint, in step with ConstraintKind in planegcs.ts. Append only:
// the numbers are the interface.
enum ConstraintCode
{
    Coincident = 0,          // point, point
    PointOnLine = 1,         // point, line
    PointOnCircle = 2,       // point, circle
    PointOnArc = 3,          // point, arc
    Parallel = 4,            // line, line
    Perpendicular = 5,       // line, line
    Horizontal = 6,          // line
    Vertical = 7,            // line
    HorizontalPoints = 8,    // point, point
    VerticalPoints = 9,      // point, point
    EqualLength = 10,        // line, line
    EqualRadiusCC = 11,      // circle, circle
    EqualRadiusCA = 12,      // circle, arc
    EqualRadiusAA = 13,      // arc, arc
    TangentLC = 14,          // line, circle
    TangentLA = 15,          // line, arc
    TangentCC = 16,          // circle, circle
    TangentAA = 17,          // arc, arc
    TangentCA = 18,          // circle, arc
    SymmetricLine = 19,      // point, point, line
    SymmetricPoint = 20,     // point, point, point
    ArcRules = 21,           // arc
    P2PDistance = 22,        // point, point, param
    P2LDistance = 23,        // point, line, param
    Difference = 24,         // param, param, param (second - first = third)
    Equal = 25,              // param, param
    CircleRadius = 26,       // circle, param
    ArcRadius = 27,          // arc, param
    CircleDiameter = 28,     // circle, param
    ArcDiameter = 29,        // arc, param
    L2LAngle = 30,           // line, line, param
    CoordinateX = 31,        // point, param
    CoordinateY = 32,        // point, param
    MidpointOnLine = 33,     // line, line (first's midpoint on the second)
    P2PAngle = 34,           // point, point, param
    PointOnPerpBisector = 35,// point, line
};

class Sketch
{
public:
    Sketch() = default;
    Sketch(const Sketch&) = delete;
    Sketch& operator=(const Sketch&) = delete;

    int addParam(double value, int kind)
    {
        params.push_back(value);
        kinds.push_back(kind);
        return static_cast<int>(params.size()) - 1;
    }
    double getParam(int i) const
    {
        return params.at(i);
    }
    void setParam(int i, double value)
    {
        params.at(i) = value;
    }
    void setParamKind(int i, int kind)
    {
        kinds.at(i) = kind;
    }
    emscripten::val getParams() const
    {
        return emscripten::val::array(params.begin(), params.end());
    }
    int paramCount() const
    {
        return static_cast<int>(params.size());
    }

    int addPoint(int x, int y)
    {
        points.emplace_back(param(x), param(y));
        return static_cast<int>(points.size()) - 1;
    }
    int addLine(int p1, int p2)
    {
        GCS::Line l;
        l.p1 = points.at(p1);
        l.p2 = points.at(p2);
        lines.push_back(l);
        return static_cast<int>(lines.size()) - 1;
    }
    int addCircle(int center, int radius)
    {
        GCS::Circle c;
        c.center = points.at(center);
        c.rad = param(radius);
        circles.push_back(c);
        return static_cast<int>(circles.size()) - 1;
    }
    // An arc's start and end points follow from its centre, radius and angles only through
    // an ArcRules constraint, which the caller adds.
    int addArc(int center, int radius, int startAngle, int endAngle, int start, int end)
    {
        GCS::Arc a;
        a.center = points.at(center);
        a.rad = param(radius);
        a.startAngle = param(startAngle);
        a.endAngle = param(endAngle);
        a.start = points.at(start);
        a.end = points.at(end);
        arcs.push_back(a);
        return static_cast<int>(arcs.size()) - 1;
    }

    // Adds one constraint. `ids` are point, line, circle, arc or parameter indices as the
    // code's comment above lists. Returns the index of the last PlaneGCS constraint added
    // (a kind may add two), or -1 for a tag below 1 or an unknown code. The module is built
    // without C++ exceptions, so an index out of range aborts (a RuntimeError in JS);
    // planegcs.ts checks indices before calling.
    int addConstraint(int code, const emscripten::val& idArray, int tag, bool driving)
    {
        const std::vector<int> ids = emscripten::vecFromJSArray<int>(idArray);
        if (tag < 1) {
            return -1;
        }
        auto P = [&](int i) -> GCS::Point& { return points.at(ids.at(i)); };
        auto L = [&](int i) -> GCS::Line& { return lines.at(ids.at(i)); };
        auto C = [&](int i) -> GCS::Circle& { return circles.at(ids.at(i)); };
        auto A = [&](int i) -> GCS::Arc& { return arcs.at(ids.at(i)); };
        auto V = [&](int i) -> double* { return param(ids.at(i)); };
        switch (code) {
            case Coincident:
                return sys.addConstraintP2PCoincident(P(0), P(1), tag, driving);
            case PointOnLine:
                return sys.addConstraintPointOnLine(P(0), L(1), tag, driving);
            case PointOnCircle:
                return sys.addConstraintPointOnCircle(P(0), C(1), tag, driving);
            case PointOnArc:
                return sys.addConstraintPointOnArc(P(0), A(1), tag, driving);
            case Parallel:
                return sys.addConstraintParallel(L(0), L(1), tag, driving);
            case Perpendicular:
                return sys.addConstraintPerpendicular(L(0), L(1), tag, driving);
            case Horizontal:
                return sys.addConstraintHorizontal(L(0), tag, driving);
            case Vertical:
                return sys.addConstraintVertical(L(0), tag, driving);
            case HorizontalPoints:
                return sys.addConstraintHorizontal(P(0), P(1), tag, driving);
            case VerticalPoints:
                return sys.addConstraintVertical(P(0), P(1), tag, driving);
            case EqualLength:
                return sys.addConstraintEqualLength(L(0), L(1), tag, driving);
            case EqualRadiusCC:
                return sys.addConstraintEqualRadius(C(0), C(1), tag, driving);
            case EqualRadiusCA:
                return sys.addConstraintEqualRadius(C(0), A(1), tag, driving);
            case EqualRadiusAA:
                return sys.addConstraintEqualRadius(A(0), A(1), tag, driving);
            case TangentLC:
                return sys.addConstraintTangent(L(0), C(1), tag, driving);
            case TangentLA:
                return sys.addConstraintTangent(L(0), A(1), tag, driving);
            case TangentCC:
                return sys.addConstraintTangent(C(0), C(1), tag, driving);
            case TangentAA:
                return sys.addConstraintTangent(A(0), A(1), tag, driving);
            case TangentCA:
                return sys.addConstraintTangent(C(0), A(1), tag, driving);
            case SymmetricLine:
                return sys.addConstraintP2PSymmetric(P(0), P(1), L(2), tag, driving);
            case SymmetricPoint:
                return sys.addConstraintP2PSymmetric(P(0), P(1), P(2), tag, driving);
            case ArcRules:
                return sys.addConstraintArcRules(A(0), tag, driving);
            case P2PDistance:
                return sys.addConstraintP2PDistance(P(0), P(1), V(2), tag, driving);
            case P2LDistance:
                return sys.addConstraintP2LDistance(P(0), L(1), V(2), tag, driving);
            case Difference:
                return sys.addConstraintDifference(V(0), V(1), V(2), tag, driving);
            case Equal:
                return sys.addConstraintEqual(V(0), V(1), tag, driving);
            case CircleRadius:
                return sys.addConstraintCircleRadius(C(0), V(1), tag, driving);
            case ArcRadius:
                return sys.addConstraintArcRadius(A(0), V(1), tag, driving);
            case CircleDiameter:
                return sys.addConstraintCircleDiameter(C(0), V(1), tag, driving);
            case ArcDiameter:
                return sys.addConstraintArcDiameter(A(0), V(1), tag, driving);
            case L2LAngle:
                return sys.addConstraintL2LAngle(L(0), L(1), V(2), tag, driving);
            case CoordinateX:
                return sys.addConstraintCoordinateX(P(0), V(1), tag, driving);
            case CoordinateY:
                return sys.addConstraintCoordinateY(P(0), V(1), tag, driving);
            case MidpointOnLine:
                return sys.addConstraintMidpointOnLine(L(0), L(1), tag, driving);
            case P2PAngle:
                return sys.addConstraintP2PAngle(P(0), P(1), V(2), tag, driving);
            case PointOnPerpBisector:
                return sys.addConstraintPointOnPerpBisector(P(0), L(1), tag, driving);
            default:
                return -1;
        }
    }

    void removeTag(int tag)
    {
        sys.clearByTag(tag);
    }
    void clearConstraints()
    {
        sys.clear();
    }

    // Solves for the unknown parameters. Returns PlaneGCS's SolveStatus: 0 Success,
    // 1 Converged, 2 Failed, 3 SuccessfulSolutionInvalid. Parameters change only on 0 or 1.
    int solve(int algorithm)
    {
        prepare(static_cast<GCS::Algorithm>(algorithm));
        int status = sys.solve(true, static_cast<GCS::Algorithm>(algorithm));
        if (status == GCS::Success || status == GCS::Converged) {
            sys.applySolution();
        }
        else {
            sys.undoSolution();
        }
        return status;
    }

    // Degrees of freedom left, after which conflicting() and redundant() hold the tags of
    // the constraints that fight each other or add nothing.
    int diagnose(int algorithm)
    {
        prepare(static_cast<GCS::Algorithm>(algorithm));
        return sys.diagnose(static_cast<GCS::Algorithm>(algorithm));
    }
    emscripten::val conflicting() const
    {
        GCS::VEC_I out;
        sys.getConflicting(out);
        return emscripten::val::array(out.begin(), out.end());
    }
    emscripten::val redundant() const
    {
        GCS::VEC_I out;
        sys.getRedundant(out);
        return emscripten::val::array(out.begin(), out.end());
    }
    emscripten::val partiallyRedundant() const
    {
        GCS::VEC_I out;
        sys.getPartiallyRedundant(out);
        return emscripten::val::array(out.begin(), out.end());
    }

private:
    double* param(int i)
    {
        return &params.at(i);
    }

    void prepare(GCS::Algorithm algorithm)
    {
        GCS::VEC_pD unknowns;
        GCS::VEC_pD driven;
        // As in FreeCAD's Sketch::setUpSketch, a driven parameter is an unknown too (the
        // solver computes it) and is also declared driven, so diagnosis leaves it out.
        for (std::size_t i = 0; i < params.size(); ++i) {
            if (kinds[i] != Fixed) {
                unknowns.push_back(&params[i]);
            }
            if (kinds[i] == Driven) {
                driven.push_back(&params[i]);
            }
        }
        sys.declareUnknowns(unknowns);
        sys.declareDrivenParams(driven);
        sys.initSolution(algorithm);
    }

    std::deque<double> params;
    std::deque<int> kinds;
    std::deque<GCS::Point> points;
    std::deque<GCS::Line> lines;
    std::deque<GCS::Circle> circles;
    std::deque<GCS::Arc> arcs;
    GCS::System sys;
};

}  // namespace

EMSCRIPTEN_BINDINGS(planegcs)
{
    emscripten::class_<Sketch>("Sketch")
        .constructor<>()
        .function("addParam", &Sketch::addParam)
        .function("getParam", &Sketch::getParam)
        .function("setParam", &Sketch::setParam)
        .function("setParamKind", &Sketch::setParamKind)
        .function("getParams", &Sketch::getParams)
        .function("paramCount", &Sketch::paramCount)
        .function("addPoint", &Sketch::addPoint)
        .function("addLine", &Sketch::addLine)
        .function("addCircle", &Sketch::addCircle)
        .function("addArc", &Sketch::addArc)
        .function("addConstraint", &Sketch::addConstraint)
        .function("removeTag", &Sketch::removeTag)
        .function("clearConstraints", &Sketch::clearConstraints)
        .function("solve", &Sketch::solve)
        .function("diagnose", &Sketch::diagnose)
        .function("conflicting", &Sketch::conflicting)
        .function("redundant", &Sketch::redundant)
        .function("partiallyRedundant", &Sketch::partiallyRedundant);
}
