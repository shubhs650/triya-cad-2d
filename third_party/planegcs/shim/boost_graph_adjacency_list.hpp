// Triya stand-in (MIT, Triya CAD 2D) for the part of Boost.Graph that GCS.cpp uses to split
// a system into decoupled components: an undirected adjacency_list, add_vertex, add_edge,
// num_vertices and connected_components. Boost (BSL-1.0) is not on Triya's license list.
//
// connected_components numbers the components as Boost's DFS-based implementation does:
// in the order of each component's lowest vertex, from 0. GCS.cpp indexes its reduction
// maps and subsystems by these numbers, so the numbering must match for the solver to
// behave as in FreeCAD.
#pragma once

#include <cstddef>
#include <numeric>
#include <utility>
#include <vector>

namespace boost
{
struct vecS
{
};
struct undirectedS
{
};

template<typename OutEdgeList, typename VertexList, typename Directed>
struct adjacency_list
{
    // Union-find over the vertices; edges are only ever used for connectivity.
    std::vector<int> parent;

    int find(int v)
    {
        while (parent[v] != v) {
            parent[v] = parent[parent[v]];
            v = parent[v];
        }
        return v;
    }
};

template<typename O, typename V, typename D>
int add_vertex(adjacency_list<O, V, D>& g)
{
    int v = static_cast<int>(g.parent.size());
    g.parent.push_back(v);
    return v;
}

template<typename O, typename V, typename D>
std::pair<int, bool> add_edge(int a, int b, adjacency_list<O, V, D>& g)
{
    int ra = g.find(a);
    int rb = g.find(b);
    if (ra != rb) {
        // Keep the lower vertex as the root, so a component's root is its lowest vertex.
        if (ra < rb) {
            g.parent[rb] = ra;
        }
        else {
            g.parent[ra] = rb;
        }
    }
    return {a, true};
}

template<typename O, typename V, typename D>
std::size_t num_vertices(const adjacency_list<O, V, D>& g)
{
    return g.parent.size();
}

template<typename O, typename V, typename D>
int connected_components(adjacency_list<O, V, D>& g, int* component)
{
    int n = static_cast<int>(g.parent.size());
    std::vector<int> idOfRoot(n, -1);
    int count = 0;
    for (int v = 0; v < n; ++v) {
        int r = g.find(v);
        if (idOfRoot[r] < 0) {
            idOfRoot[r] = count++;
        }
        component[v] = idOfRoot[r];
    }
    return count;
}
}  // namespace boost
