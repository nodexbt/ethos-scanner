"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { useRouter } from "next/navigation";

interface EthosProfile {
  id: number;
  profileId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  score: number;
  isDiscovered?: boolean;
  discoveryLevel?: number;
}

interface ReviewActivity {
  type: "review";
  data: {
    id: number;
    authorProfileId: number;
    score: "positive" | "neutral" | "negative";
  };
  author: {
    profileId: number;
    name: string;
  };
  subject: {
    profileId: number;
    name: string;
  };
}

interface Vouch {
  authorProfileId: number;
  subjectProfileId: number;
  balance?: string;
}

interface ClusterMapProps {
  profiles: EthosProfile[];
  reviews: ReviewActivity[];
  vouches: Vouch[];
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  profileId: number;
  name: string;
  username: string | null;
  avatarUrl: string;
  score: number;
  isDiscovered: boolean;
  discoveryLevel: number; // 0 = submitted, 1+ = discovered at that level
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  type: "review" | "vouch";
  sentiment?: "positive" | "neutral" | "negative";
}

interface Triangle {
  nodeIds: [string, string, string];
  nodes: [Node, Node, Node];
}

export function ClusterMap({ profiles, reviews, vouches }: ClusterMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showReviews, setShowReviews] = useState(true);
  const [showVouches, setShowVouches] = useState(true);
  const [showTriangles, setShowTriangles] = useState(true);
  const [detectedTriangles, setDetectedTriangles] = useState<Triangle[]>([]);
  const { theme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  // Main visualization
  useEffect(() => {
    if (!mounted || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const container = isFullscreen ? document.body : containerRef.current;
    if (!container) return;

    const width = isFullscreen ? window.innerWidth : container.clientWidth || 800;
    const height = isFullscreen ? window.innerHeight - 120 : 500;

    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");
    const defs = svg.append("defs");

    // Build nodes from profiles
    const nodeMap = new Map<string, Node>();
    profiles.forEach((profile) => {
      const id = profile.profileId!.toString();
      nodeMap.set(id, {
        id,
        profileId: profile.profileId!,
        name: profile.displayName,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        score: profile.score,
        isDiscovered: profile.isDiscovered || false,
        discoveryLevel: profile.discoveryLevel || 0,
      });
    });

    const nodes = Array.from(nodeMap.values());

    // Build links from reviews and vouches
    const links: Link[] = [];
    const linkSet = new Set<string>();

    if (showReviews) {
      reviews.forEach((review) => {
        // Skip if profileId is null (uninitialized profiles)
        if (!review.author.profileId || !review.subject.profileId) return;

        const sourceId = review.author.profileId.toString();
        const targetId = review.subject.profileId.toString();
        const key = `review-${sourceId}-${targetId}`;

        if (!linkSet.has(key) && nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          linkSet.add(key);
          links.push({
            source: sourceId,
            target: targetId,
            type: "review",
            sentiment: review.data.score,
          });
        }
      });
    }

    if (showVouches) {
      vouches.forEach((vouch) => {
        // Skip if profileId is null
        if (!vouch.authorProfileId || !vouch.subjectProfileId) return;

        const sourceId = vouch.authorProfileId.toString();
        const targetId = vouch.subjectProfileId.toString();
        const key = `vouch-${sourceId}-${targetId}`;

        if (!linkSet.has(key) && nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          linkSet.add(key);
          links.push({
            source: sourceId,
            target: targetId,
            type: "vouch",
          });
        }
      });
    }

    // Detect triangles (only for positive reviews, no reciprocation)
    const positiveReviewMap = new Map<string, Set<string>>();
    const allEdges = new Set<string>();

    links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      allEdges.add(`${sourceId}-${targetId}`);

      if (link.type === "review" && link.sentiment === "positive") {
        if (!positiveReviewMap.has(sourceId)) {
          positiveReviewMap.set(sourceId, new Set());
        }
        positiveReviewMap.get(sourceId)!.add(targetId);
      }
    });

    const triangles: Triangle[] = [];
    const triangleEdges = new Set<string>();

    nodes.forEach((nodeA) => {
      const neighborsA = positiveReviewMap.get(nodeA.id);
      if (!neighborsA) return;

      neighborsA.forEach((nodeBId) => {
        const neighborsB = positiveReviewMap.get(nodeBId);
        if (!neighborsB) return;

        neighborsB.forEach((nodeCId) => {
          const neighborsC = positiveReviewMap.get(nodeCId);
          if (!neighborsC) return;

          if (neighborsC.has(nodeA.id)) {
            // Check no reciprocation
            const edge1Reciprocated = allEdges.has(`${nodeBId}-${nodeA.id}`);
            const edge2Reciprocated = allEdges.has(`${nodeCId}-${nodeBId}`);
            const edge3Reciprocated = allEdges.has(`${nodeA.id}-${nodeCId}`);

            if (!edge1Reciprocated && !edge2Reciprocated && !edge3Reciprocated) {
              const sortedIds = [nodeA.id, nodeBId, nodeCId].sort();
              const triangleKey = sortedIds.join("-");

              if (!triangleEdges.has(triangleKey)) {
                triangleEdges.add(triangleKey);
                const nodeB = nodeMap.get(nodeBId);
                const nodeC = nodeMap.get(nodeCId);
                if (nodeB && nodeC) {
                  triangles.push({
                    nodeIds: [nodeA.id, nodeBId, nodeCId],
                    nodes: [nodeA, nodeB, nodeC],
                  });
                }
              }
            }
          }
        });
      });
    });

    setDetectedTriangles(triangles);

    // Colors
    const getLinkColor = (link: Link) => {
      if (link.type === "vouch") return "#3b82f6"; // Blue for vouches
      switch (link.sentiment) {
        case "positive":
          return "#10b981"; // Green
        case "negative":
          return "#ef4444"; // Red
        default:
          return "#94a3b8"; // Gray
      }
    };

    // Set up zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Triangle group (behind everything)
    const triangleGroup = g.append("g").attr("class", "triangles").lower();

    // Create force simulation
    const simulation = d3
      .forceSimulation(nodes)
      .alphaDecay(0.05)
      .velocityDecay(0.4)
      .force(
        "link",
        d3
          .forceLink<Node, Link>(links)
          .id((d) => d.id)
          .distance(150)
      )
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(60));

    // Create links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", (d) => getLinkColor(d))
      .attr("stroke-opacity", 0.7)
      .attr("stroke-width", 2.5)
      .attr("stroke-dasharray", (d) => (d.type === "vouch" ? "5,5" : "none"));

    // Create arrow markers
    const arrowMarkers = g
      .append("g")
      .attr("class", "arrow-markers")
      .selectAll("path")
      .data(links)
      .enter()
      .append("path")
      .attr("d", "M-6,-4 L0,0 L-6,4 Z")
      .attr("fill", (d) => getLinkColor(d))
      .attr("opacity", 0.8);

    // Create node groups
    const nodeGroups = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("cursor", "pointer")
      .on("click", (_, d) => {
        router.push(`/${encodeURIComponent(d.username || d.id)}`);
      })
      .call(
        d3
          .drag<SVGGElement, Node>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Add circles - color based on discovery level
    // Level 0 (submitted) = blue, Level 1 = amber, Level 2 = orange, Level 3 = red-orange
    const getNodeColor = (level: number) => {
      if (level === 0) return "#3b82f6"; // Blue - submitted
      if (level === 1) return "#f59e0b"; // Amber - 1st degree
      if (level === 2) return "#f97316"; // Orange - 2nd degree
      return "#ea580c"; // Deep orange - 3rd+ degree
    };

    nodeGroups
      .append("circle")
      .attr("r", 30)
      .attr("fill", (d) => getNodeColor(d.discoveryLevel))
      .attr("stroke", (d) => getNodeColor(d.discoveryLevel))
      .attr("stroke-width", (d) => d.isDiscovered ? 4 : 2)
      .attr("stroke-dasharray", (d) => d.isDiscovered ? "5,3" : "none")
      .attr("opacity", 0.9);

    // Add images
    nodeGroups
      .append("image")
      .attr("xlink:href", (d) => d.avatarUrl || "")
      .attr("href", (d) => d.avatarUrl || "")
      .attr("x", -25)
      .attr("y", -25)
      .attr("width", 50)
      .attr("height", 50)
      .attr("clip-path", (d) => `url(#clip-cluster-${d.id})`)
      .style("opacity", (d) => (d.avatarUrl ? 1 : 0));

    // Add clip paths
    nodes.forEach((node) => {
      defs
        .append("clipPath")
        .attr("id", `clip-cluster-${node.id}`)
        .append("circle")
        .attr("r", 25);
    });

    // Theme-aware colors
    const isDarkTheme = theme === "dark";
    const textColor = isDarkTheme ? "hsl(0, 0%, 98%)" : "hsl(0, 0%, 15%)";
    const mutedColor = isDarkTheme ? "hsl(0, 0%, 70%)" : "hsl(0, 0%, 45%)";

    // Add labels
    nodeGroups
      .append("text")
      .attr("dy", 45)
      .attr("text-anchor", "middle")
      .attr("fill", textColor)
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .text((d) => d.name);

    nodeGroups
      .append("text")
      .attr("dy", 58)
      .attr("text-anchor", "middle")
      .attr("fill", mutedColor)
      .attr("font-size", "10px")
      .text((d) => `Score: ${d.score}`);

    // Add discovery level label for discovered profiles
    nodeGroups
      .filter((d) => d.isDiscovered)
      .append("text")
      .attr("dy", 70)
      .attr("text-anchor", "middle")
      .attr("fill", (d) => getNodeColor(d.discoveryLevel))
      .attr("font-size", "9px")
      .attr("font-weight", "bold")
      .text((d) => `L${d.discoveryLevel} DISCOVERED`);

    // Update positions on tick
    simulation.on("tick", () => {
      // Update triangle highlights
      if (showTriangles && triangles.length > 0) {
        const triangleEdgeData: { x1: number; y1: number; x2: number; y2: number }[] = [];
        triangles.forEach((t) => {
          const [n1, n2, n3] = t.nodes;
          triangleEdgeData.push({ x1: n1.x ?? 0, y1: n1.y ?? 0, x2: n2.x ?? 0, y2: n2.y ?? 0 });
          triangleEdgeData.push({ x1: n2.x ?? 0, y1: n2.y ?? 0, x2: n3.x ?? 0, y2: n3.y ?? 0 });
          triangleEdgeData.push({ x1: n3.x ?? 0, y1: n3.y ?? 0, x2: n1.x ?? 0, y2: n1.y ?? 0 });
        });

        triangleGroup
          .selectAll("line.triangle-edge")
          .data(triangleEdgeData)
          .join("line")
          .attr("class", "triangle-edge")
          .attr("x1", (d) => d.x1)
          .attr("y1", (d) => d.y1)
          .attr("x2", (d) => d.x2)
          .attr("y2", (d) => d.y2)
          .attr("stroke", "#ef4444")
          .attr("stroke-width", 4)
          .attr("stroke-opacity", 0.5);
      } else {
        triangleGroup.selectAll("line.triangle-edge").remove();
      }

      link
        .attr("x1", (d) => (d.source as Node).x ?? 0)
        .attr("y1", (d) => (d.source as Node).y ?? 0)
        .attr("x2", (d) => (d.target as Node).x ?? 0)
        .attr("y2", (d) => (d.target as Node).y ?? 0);

      arrowMarkers.attr("transform", (d) => {
        const source = d.source as Node;
        const target = d.target as Node;
        const x1 = source.x ?? 0;
        const y1 = source.y ?? 0;
        const x2 = target.x ?? 0;
        const y2 = target.y ?? 0;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        return `translate(${midX}, ${midY}) rotate(${angle})`;
      });

      nodeGroups.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    // Initial zoom to fit
    const initialScale = 0.8;
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(width * (1 - initialScale) / 2, height * (1 - initialScale) / 2).scale(initialScale)
    );

    return () => {
      simulation.stop();
    };
  }, [mounted, profiles, reviews, vouches, showReviews, showVouches, showTriangles, isFullscreen, theme, router]);

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  const resetView = () => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight;
      const scale = 0.8;
      svg
        .transition()
        .duration(500)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(width * (1 - scale) / 2, height * (1 - scale) / 2).scale(scale)
        );
    }
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="flex items-center justify-between p-2 border-b">
            <div className="flex items-center gap-4">
              <div className="text-sm font-medium">
                Cluster Map: {profiles.length} profiles, {reviews.length + vouches.length} connections
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={showReviews}
                    onChange={(e) => setShowReviews(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span>Reviews</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={showVouches}
                    onChange={(e) => setShowVouches(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span>Vouches</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={showTriangles}
                    onChange={(e) => setShowTriangles(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span>
                    Triangles
                    {detectedTriangles.length > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold bg-red-500 text-white rounded-full">
                        {detectedTriangles.length}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleFullscreen}>
                <Minimize2 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={resetView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1">
            <svg ref={svgRef} className="w-full h-full" />
          </div>
        </div>
      )}
      {!isFullscreen && (
        <div ref={containerRef} className="w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={showReviews}
                  onChange={(e) => setShowReviews(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-green-500 inline-block"></span>
                  Reviews
                </span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={showVouches}
                  onChange={(e) => setShowVouches(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-blue-500 inline-block" style={{ borderBottom: "2px dashed" }}></span>
                  Vouches
                </span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={showTriangles}
                  onChange={(e) => setShowTriangles(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span>
                  Triangles
                  {detectedTriangles.length > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold bg-red-500 text-white rounded-full">
                      {detectedTriangles.length}
                    </span>
                  )}
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleFullscreen}>
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={resetView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="w-full h-[500px] border rounded-lg overflow-hidden">
            <svg ref={svgRef} className="w-full h-full" />
          </div>
        </div>
      )}
    </>
  );
}
