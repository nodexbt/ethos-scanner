"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface User {
  id: number;
  profileId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  score: number;
}

interface ReviewActivity {
  type: "review";
  data: {
    id: number;
    authorProfileId: number;
    author: string;
    subject: string;
    score: "positive" | "neutral" | "negative";
    comment?: string;
    createdAt: number;
    archived: boolean;
  };
  authorUser: User;
  subjectUser: User;
  author: {
    profileId: number;
    name: string;
    username: string | null;
    avatar: string;
  };
  subject: {
    profileId: number;
    name: string;
    username: string | null;
    avatar: string;
  };
}

interface ReviewsResponse {
  values: ReviewActivity[];
  total?: number;
}

interface ReviewActivityWithLevel extends ReviewActivity {
  level: number;
}

interface ReviewsMapProps {
  userId: number;
  profileId: number | null;
  userName: string;
  avatarUrl?: string;
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  profileId: number | null;
  name: string;
  username: string | null;
  avatarUrl: string;
  score: number;
  isRoot: boolean;
  reviewType: "given" | "received" | "both" | "root";
  level: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  sentiment?: "positive" | "neutral" | "negative";
}

// Performance limits
const MAX_LEVEL_1_NODES_REVIEWS = 50;
const MAX_LEVEL_2_PROFILES_TO_FETCH_REVIEWS = 10;
const MAX_LEVEL_2_NODES_PER_PROFILE_REVIEWS = 20;
const MAX_TOTAL_NODES_REVIEWS = 200;

export function ReviewsMap({ userId, profileId, userName, avatarUrl = "" }: ReviewsMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [allReviews, setAllReviews] = useState<ReviewActivityWithLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent body scroll when in fullscreen mode
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

  // Handle resize events to update SVG dimensions
  useEffect(() => {
    const handleResize = () => {
      // Trigger re-render when window is resized
      if (isFullscreen) {
        // Force a state update to trigger SVG resize
        setIsFullscreen((prev) => prev);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!mounted) return;

    const fetchReviews = async () => {
      if (!profileId) {
        setError("Profile ID not available");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const allReviewsWithLevels: ReviewActivityWithLevel[] = [];
        const processedProfileIds = new Set<number>([profileId]);
        const profileIdsToProcess = [profileId];
        const userkey = `profileId:${profileId}`;

        // Fetch level 1 reviews
        const givenResponse = await fetch(
          "https://api.ethos.network/api/v2/activities/profile/given",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({
              userkey: userkey,
              filter: ["review"],
              limit: MAX_LEVEL_1_NODES_REVIEWS,
            }),
          }
        );

        const receivedResponse = await fetch(
          "https://api.ethos.network/api/v2/activities/profile/received",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({
              userkey: userkey,
              filter: ["review"],
              limit: MAX_LEVEL_1_NODES_REVIEWS,
            }),
          }
        );

        if (!givenResponse.ok || !receivedResponse.ok) {
          setError("Failed to fetch reviews");
          return;
        }

        const givenData: ReviewsResponse = await givenResponse.json();
        const receivedData: ReviewsResponse = await receivedResponse.json();

        // Add level 1 reviews (already limited by API limit)
        (givenData.values || []).forEach((activity) => {
          if (allReviewsWithLevels.length >= MAX_TOTAL_NODES_REVIEWS) return;
          if (activity.subject.profileId) {
            allReviewsWithLevels.push({ ...activity, level: 1 });
            if (!processedProfileIds.has(activity.subject.profileId)) {
              profileIdsToProcess.push(activity.subject.profileId);
              processedProfileIds.add(activity.subject.profileId);
            }
          }
        });

        (receivedData.values || []).forEach((activity) => {
          if (allReviewsWithLevels.length >= MAX_TOTAL_NODES_REVIEWS) return;
          if (activity.author.profileId) {
            allReviewsWithLevels.push({ ...activity, level: 1 });
            if (!processedProfileIds.has(activity.author.profileId)) {
              profileIdsToProcess.push(activity.author.profileId);
              processedProfileIds.add(activity.author.profileId);
            }
          }
        });

        // Set level 1 data first for immediate display
        setAllReviews(allReviewsWithLevels);
        setLoading(false);

        // Fetch level 2 reviews in background (progressive loading)
        const level2ProfileIds = profileIdsToProcess.slice(1, MAX_LEVEL_2_PROFILES_TO_FETCH_REVIEWS + 1);
        
        // Parallelize all level 2 API calls
        const level2Promises = level2ProfileIds.map(async (pid) => {
          try {
            const level2Userkey = `profileId:${pid}`;
            const [level2Given, level2Received] = await Promise.all([
              fetch("https://api.ethos.network/api/v2/activities/profile/given", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Ethos-Client": "ethos-scanner@0.1.0",
                },
                body: JSON.stringify({
                  userkey: level2Userkey,
                  filter: ["review"],
                  limit: MAX_LEVEL_2_NODES_PER_PROFILE_REVIEWS,
                }),
              }),
              fetch("https://api.ethos.network/api/v2/activities/profile/received", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Ethos-Client": "ethos-scanner@0.1.0",
                },
                body: JSON.stringify({
                  userkey: level2Userkey,
                  filter: ["review"],
                  limit: MAX_LEVEL_2_NODES_PER_PROFILE_REVIEWS,
                }),
              }),
            ]);

            const results: ReviewActivityWithLevel[] = [];

            if (level2Given.ok) {
              const data: ReviewsResponse = await level2Given.json();
              const level2Reviews = (data.values || []).slice(0, MAX_LEVEL_2_NODES_PER_PROFILE_REVIEWS);
              level2Reviews.forEach((activity) => {
                if (activity.subject.profileId) {
                  results.push({ ...activity, level: 2 });
                }
              });
            }

            if (level2Received.ok) {
              const data: ReviewsResponse = await level2Received.json();
              const level2Reviews = (data.values || []).slice(0, MAX_LEVEL_2_NODES_PER_PROFILE_REVIEWS);
              level2Reviews.forEach((activity) => {
                if (activity.author.profileId) {
                  results.push({ ...activity, level: 2 });
                }
              });
            }

            return results;
          } catch (e) {
            return [];
          }
        });

        // Wait for all level 2 calls and update
        const level2Results = await Promise.all(level2Promises);
        const level2Reviews = level2Results.flat().slice(0, MAX_TOTAL_NODES_REVIEWS - allReviewsWithLevels.length);
        
        // Update with combined data
        setAllReviews([...allReviewsWithLevels, ...level2Reviews]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch reviews"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, [profileId, mounted]);

  useEffect(() => {
    if (
      !mounted ||
      !svgRef.current ||
      loading ||
      allReviews.length === 0
    )
      return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    if (!svgRef.current.hasAttribute("xmlns:xlink")) {
      svgRef.current.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    }

    const container = svgRef.current.parentElement;
    let width: number;
    let height: number;
    
    if (isFullscreen) {
      // Use viewport dimensions in fullscreen mode
      width = window.innerWidth - 64; // Account for padding (32px * 2)
      height = window.innerHeight - 200; // Account for header and padding
    } else {
      width = container ? Math.min(container.clientWidth - 32, 1000) : 1000;
      height = Math.max(600, Math.min(allReviews.length * 15 + 300, 800));
    }
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

    // Create a container group for pan/zoom
    const g = svg.append("g").attr("class", "zoom-container");

    // Create dot grid pattern for background
    const defs = svg.append("defs");
    const isDark = document.documentElement.classList.contains("dark");
    const dotColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
    const dotSize = 2;
    const dotSpacing = 20;

    const pattern = defs
      .append("pattern")
      .attr("id", "dot-grid-reviews")
      .attr("width", dotSpacing)
      .attr("height", dotSpacing)
      .attr("patternUnits", "userSpaceOnUse");

    pattern
      .append("circle")
      .attr("cx", dotSpacing / 2)
      .attr("cy", dotSpacing / 2)
      .attr("r", dotSize / 2)
      .attr("fill", dotColor);

    // Add background rectangle with dot grid pattern
    const bgSize = Math.max(width, height) * 5;
    g.append("rect")
      .attr("width", bgSize)
      .attr("height", bgSize)
      .attr("fill", "url(#dot-grid-reviews)")
      .attr("x", -bgSize / 2 + width / 2)
      .attr("y", -bgSize / 2 + height / 2);

    const rootProfileId = profileId || userId;
    const rootId = rootProfileId.toString();

    // Create root node
    const rootNode: Node = {
      id: rootId,
      profileId: profileId,
      name: userName,
      username: null,
      avatarUrl: avatarUrl || "",
      score: 0,
      isRoot: true,
      reviewType: "root",
      level: 0,
    };

    // Create nodes map
    const nodeMap = new Map<string, Node>();
    nodeMap.set(rootId, rootNode);

    // Process all reviews with levels
    // Use a map to track the minimum level for each user
    const userMinLevels = new Map<string, number>();
    
    allReviews.forEach((activity) => {
      // Track minimum level for each user
      if (activity.subject.profileId) {
        const subjectId = activity.subject.profileId.toString();
        const currentMin = userMinLevels.get(subjectId);
        if (currentMin === undefined || activity.level < currentMin) {
          userMinLevels.set(subjectId, activity.level);
        }
      }
      if (activity.author.profileId && activity.author.profileId !== profileId) {
        const authorId = activity.author.profileId.toString();
        const currentMin = userMinLevels.get(authorId);
        if (currentMin === undefined || activity.level < currentMin) {
          userMinLevels.set(authorId, activity.level);
        }
      }
    });

    // Create nodes with minimum level (ensures each user appears only once)
    allReviews.forEach((activity) => {
      // Process subject
      if (activity.subject.profileId) {
        const subjectId = activity.subject.profileId.toString();
        if (!nodeMap.has(subjectId)) {
          const minLevel = userMinLevels.get(subjectId) || activity.level;
          nodeMap.set(subjectId, {
            id: subjectId,
            profileId: activity.subject.profileId,
            name: activity.subject.name,
            username: activity.subject.username,
            avatarUrl: activity.subject.avatar,
            score: activity.subjectUser.score,
            isRoot: false,
            reviewType: activity.author.profileId === profileId ? "received" : "given",
            level: minLevel,
          });
        } else {
          const node = nodeMap.get(subjectId)!;
          // Update to minimum level if this connection has a lower level
          const minLevel = userMinLevels.get(subjectId) || node.level;
          if (minLevel < node.level) {
            node.level = minLevel;
          }
          if (node.reviewType !== "both") {
            node.reviewType = "both";
          }
        }
      }

      // Process author
      if (activity.author.profileId && activity.author.profileId !== profileId) {
        const authorId = activity.author.profileId.toString();
        if (!nodeMap.has(authorId)) {
          const minLevel = userMinLevels.get(authorId) || activity.level;
          nodeMap.set(authorId, {
            id: authorId,
            profileId: activity.author.profileId,
            name: activity.author.name,
            username: activity.author.username,
            avatarUrl: activity.author.avatar,
            score: activity.authorUser.score,
            isRoot: false,
            reviewType: activity.subject.profileId === profileId ? "given" : "received",
            level: minLevel,
          });
        } else {
          const node = nodeMap.get(authorId)!;
          // Update to minimum level if this connection has a lower level
          const minLevel = userMinLevels.get(authorId) || node.level;
          if (minLevel < node.level) {
            node.level = minLevel;
          }
          if (node.reviewType !== "both") {
            node.reviewType = "both";
          }
        }
      }
    });

    // Limit nodes for performance (safety check)
    const allNodes = Array.from(nodeMap.values());
    const nodes: Node[] = allNodes.slice(0, MAX_TOTAL_NODES_REVIEWS);
    const nodeIds = new Set(nodes.map(n => n.id));

    // Create links with level information
    // Include ALL connections between any nodes in the network (not just root connections)
    const links: Link[] = allReviews
      .filter((activity) => {
        if (!activity.author.profileId || !activity.subject.profileId) return false;
        const sourceId = activity.author.profileId.toString();
        const targetId = activity.subject.profileId.toString();
        // Include link if both nodes are in the rendered set
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      })
      .map((activity) => {
        const sourceId = activity.author.profileId!.toString();
        const targetId = activity.subject.profileId!.toString();
        return {
          source: sourceId,
          target: targetId,
          sentiment: activity.data.score as "positive" | "neutral" | "negative",
        };
      });

    // Color scheme by level
    const levelColors: Record<number, string> = {
      0: "#3b82f6", // Root - blue
      1: "#10b981", // Level 1 - green
      2: "#f59e0b", // Level 2 - orange
      3: "#ef4444", // Level 3 - red
    };

    const getNodeColor = (node: Node) => {
      if (node.isRoot) return levelColors[0];
      return levelColors[node.level] || "#64748b";
    };

    const getLinkColor = (sentiment?: string) => {
      switch (sentiment) {
        case "positive":
          return "#10b981"; // Green
        case "negative":
          return "#ef4444"; // Red
        case "neutral":
        default:
          return "#94a3b8"; // Gray
      }
    };

    // Set up zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      })
      .on("start", function() {
        svg.style("cursor", "grabbing");
      })
      .on("end", function() {
        svg.style("cursor", "grab");
      });

    zoomRef.current = zoom;

    svg
      .call(zoom)
      .style("cursor", "grab")
      .on("dblclick.zoom", null);

    // Create force simulation with radial positioning for levels
    const simulation = d3
      .forceSimulation(nodes)
      .alphaDecay(0.1) // Faster convergence
      .velocityDecay(0.4) // More damping for stability
      .force(
        "link",
        d3
          .forceLink<Node, Link>(links)
          .id((d) => d.id)
          .distance((d) => {
            const source = d.source as Node;
            const target = d.target as Node;
            const levelDiff = Math.abs(target.level - source.level);
            // Increase distance for more breathing room
            return 180 + levelDiff * 100;
          })
      )
      .force("charge", d3.forceManyBody().strength((d) => {
        const node = d as Node;
        // Increase charge strength to push nodes apart more
        return node.isRoot ? -800 : -400 / (node.level + 1);
      }))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d) => {
          const node = d as Node;
          // Increase collision radius for more breathing room
          return node.isRoot ? 70 : Math.max(40, 50 - node.level * 2);
        })
      )
      .force("radial", d3.forceRadial((d) => {
        const node = d as Node;
        // Create concentric rings with more spacing
        const baseRadius = 120;
        return baseRadius + node.level * 180;
      }, width / 2, height / 2).strength(0.8));

    // Create links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", (d) => getLinkColor(d.sentiment))
      .attr("stroke-opacity", (d) => {
        const target = d.target as Node;
        return 0.4 + (1 - target.level * 0.1);
      })
      .attr("stroke-width", (d) => {
        const target = d.target as Node;
        return Math.max(1, 2 - target.level * 0.3);
      });

    // Create node groups
    const nodeGroups = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .call(
        d3
          .drag<SVGGElement, Node>()
          .on("start", function(event) {
            // Prevent zoom when dragging nodes
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
            d3.select(this).raise();
          })
          .on("drag", dragged)
          .on("end", dragended)
      );

    // Add circles with level-based sizing
    nodeGroups
      .append("circle")
      .attr("r", (d) => {
        if (d.isRoot) return 35;
        return Math.max(18, 25 - d.level * 2);
      })
      .attr("fill", (d) => getNodeColor(d))
      .attr("stroke", "#fff")
      .attr("stroke-width", (d) => (d.isRoot ? 3 : 2))
      .attr("opacity", (d) => (d.isRoot ? 1 : 0.9 - d.level * 0.1));

    // Add images with level-based sizing
    nodeGroups
      .append("image")
      .attr("xlink:href", (d) => d.avatarUrl || "")
      .attr("href", (d) => d.avatarUrl || "")
      .attr("x", (d) => {
        if (d.isRoot) return -30;
        const size = Math.max(30, 40 - d.level * 5);
        return -size / 2;
      })
      .attr("y", (d) => {
        if (d.isRoot) return -30;
        const size = Math.max(30, 40 - d.level * 5);
        return -size / 2;
      })
      .attr("width", (d) => {
        if (d.isRoot) return 60;
        return Math.max(30, 40 - d.level * 5);
      })
      .attr("height", (d) => {
        if (d.isRoot) return 60;
        return Math.max(30, 40 - d.level * 5);
      })
      .attr("clip-path", (d) => `url(#clip-reviews-${d.id})`)
      .style("opacity", (d) => (d.avatarUrl ? 1 : 0))
      .on("error", function () {
        d3.select(this).style("opacity", 0);
      });

    // Add clip paths (use existing defs) with level-based sizing
    nodes.forEach((node) => {
      const radius = node.isRoot 
        ? 30 
        : Math.max(15, 20 - node.level * 2.5);
      defs
        .append("clipPath")
        .attr("id", `clip-reviews-${node.id}`)
        .append("circle")
        .attr("r", radius);
    });

    // Get theme-aware colors from CSS variables
    const getTextColor = () => {
      const root = document.documentElement;
      const isDark = root.classList.contains("dark");
      return isDark ? "hsl(0, 0%, 98%)" : "hsl(0, 0%, 25%)";
    };

    const getMutedColor = () => {
      const root = document.documentElement;
      const isDark = root.classList.contains("dark");
      return isDark ? "hsl(0, 0%, 63.9%)" : "hsl(0, 0%, 55%)";
    };

    // Add labels with level-based positioning
    nodeGroups
      .append("text")
      .attr("dy", (d) => {
        if (d.isRoot) return 50;
        const radius = Math.max(18, 25 - d.level * 2);
        return 35 + radius;
      })
      .attr("text-anchor", "middle")
      .attr("fill", getTextColor())
      .attr("font-size", (d) => {
        if (d.isRoot) return "14px";
        return `${Math.max(10, 12 - d.level * 0.5)}px`;
      })
      .attr("font-weight", (d) => (d.isRoot || d.level === 1 ? "bold" : "normal"))
      .text((d) => d.name || d.username || d.id);

    // Add score labels with level-based positioning
    nodeGroups
      .append("text")
      .attr("dy", (d) => {
        if (d.isRoot) return 65;
        const radius = Math.max(18, 25 - d.level * 2);
        return 50 + radius;
      })
      .attr("text-anchor", "middle")
      .attr("fill", getMutedColor())
      .attr("font-size", (d) => `${Math.max(8, 10 - d.level * 0.3)}px`)
      .text((d) => (d.score > 0 ? `Score: ${d.score}` : ""));

    // Update positions
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as Node).x ?? 0)
        .attr("y1", (d) => (d.source as Node).y ?? 0)
        .attr("x2", (d) => (d.target as Node).x ?? 0)
        .attr("y2", (d) => (d.target as Node).y ?? 0);

      nodeGroups.attr("transform", (d) => {
        const x = d.x ?? width / 2;
        const y = d.y ?? height / 2;
        return `translate(${x},${y})`;
      });
    });

    function dragged(event: d3.D3DragEvent<SVGGElement, Node, Node>) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, Node, Node>) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => {
      simulation.stop();
    };
  }, [
    allReviews,
    loading,
    userId,
    profileId,
    userName,
    avatarUrl,
    mounted,
    isFullscreen,
  ]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground space-y-2">
        <div className="font-medium">{error}</div>
        <div className="text-xs">
          The Ethos API currently only provides endpoints to query reviews between two specific users (using <code className="bg-background px-1 rounded">/api/v2/reviews/count/between</code> and <code className="bg-background px-1 rounded">/api/v2/reviews/latest/between</code>), not for listing all reviews given/received by a user. This feature may become available in a future API update.
        </div>
      </div>
    );
  }

  if (allReviews.length === 0) {
    return (
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        No reviews found for this user.
      </div>
    );
  }

  // Count reviews by level
  const levelCounts = allReviews.reduce((acc, review) => {
    acc[review.level] = (acc[review.level] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const levelLabels: Record<number, string> = {
    1: "1st ring",
    2: "2nd ring",
    3: "3rd ring",
  };

  const resetView = () => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    const initialTransform = d3.zoomIdentity;
    
    // If zoomRef is available, use it; otherwise get zoom from SVG
    if (zoomRef.current) {
      svg
        .transition()
        .duration(750)
        .call(zoomRef.current.transform, initialTransform);
    } else {
      // Fallback: directly set transform on the group
      const g = svg.select<SVGGElement>(".zoom-container");
      g.transition()
        .duration(750)
        .attr("transform", initialTransform.toString());
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <>
      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={toggleFullscreen}
        >
          <div 
            className="w-full h-full overflow-hidden rounded-lg border bg-background p-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="text-sm text-muted-foreground space-y-1 flex-1">
                <div>
                  Showing {allReviews.length} review{allReviews.length !== 1 ? "s" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                  {allReviews.length >= MAX_TOTAL_NODES_REVIEWS && (
                    <span className="text-xs ml-2">(limited for performance)</span>
                  )}
                </div>
                <div className="flex gap-4 flex-wrap">
                  {Object.entries(levelCounts).map(([level, count]) => (
                    <span key={level} className="inline-flex items-center gap-1">
                      <span 
                        className="inline-block w-3 h-3 rounded-full" 
                        style={{ 
                          backgroundColor: level === "0" ? "#3b82f6" : 
                                          level === "1" ? "#10b981" : 
                                          level === "2" ? "#f59e0b" : "#ef4444" 
                        }}
                      />
                      {levelLabels[parseInt(level)] || `Level ${level}`}: {count}
                    </span>
                  ))}
                </div>
                <div className="flex gap-4 flex-wrap mt-2">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-1 bg-[#10b981]" />
                    Positive
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-1 bg-[#94a3b8]" />
                    Neutral
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-1 bg-[#ef4444]" />
                    Negative
                  </span>
                </div>
              </div>
              <div className="flex gap-2 ml-4 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleFullscreen}
                  title="Exit fullscreen"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetView}
                  title="Reset view to initial position"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset View
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <svg ref={svgRef} className="w-full h-full" style={{ shapeRendering: "geometricPrecision" }}></svg>
            </div>
          </div>
        </div>
      )}
      {!isFullscreen && (
        <div ref={containerRef} className="w-full overflow-auto rounded-lg border bg-background p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="text-sm text-muted-foreground space-y-1 flex-1">
              <div>
                Showing {allReviews.length} review{allReviews.length !== 1 ? "s" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                {allReviews.length >= MAX_TOTAL_NODES_REVIEWS && (
                  <span className="text-xs ml-2">(limited for performance)</span>
                )}
              </div>
              <div className="flex gap-4 flex-wrap">
                {Object.entries(levelCounts).map(([level, count]) => (
                  <span key={level} className="inline-flex items-center gap-1">
                    <span 
                      className="inline-block w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: level === "0" ? "#3b82f6" : 
                                        level === "1" ? "#10b981" : 
                                        level === "2" ? "#f59e0b" : "#ef4444" 
                      }}
                    />
                    {levelLabels[parseInt(level)] || `Level ${level}`}: {count}
                  </span>
                ))}
              </div>
              <div className="flex gap-4 flex-wrap mt-2">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-1 bg-[#10b981]" />
                  Positive
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-1 bg-[#94a3b8]" />
                  Neutral
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-1 bg-[#ef4444]" />
                  Negative
                </span>
              </div>
            </div>
            <div className="flex gap-2 ml-4 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleFullscreen}
                title="Open in fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetView}
                title="Reset view to initial position"
              >
                <RotateCcw className="h-4 w-4" />
                Reset View
              </Button>
            </div>
          </div>
          <svg ref={svgRef} className="w-full h-auto" style={{ shapeRendering: "geometricPrecision" }}></svg>
        </div>
      )}
    </>
  );
}

