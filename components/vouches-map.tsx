"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

interface User {
  id: number;
  profileId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  score: number;
}

interface Vouch {
  authorProfileId: number;
  subjectProfileId: number;
  authorUser: User;
  subjectUser: User;
  balance?: string;
  vouchedAt?: string;
}

interface VouchesResponse {
  values: Vouch[];
  total: number;
  limit: number;
  offset: number;
}

interface VouchesMapProps {
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
  vouchType: "given" | "received" | "both" | "root";
  level: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  amount?: number;
}

interface VouchWithLevel extends Vouch {
  level: number;
}

// Performance limits
const MAX_LEVEL_1_NODES = 50;
const MAX_LEVEL_2_PROFILES_TO_FETCH = 10;
const MAX_LEVEL_2_NODES_PER_PROFILE = 20;
const MAX_TOTAL_NODES = 200;

export function VouchesMap({ userId, profileId, userName, avatarUrl = "" }: VouchesMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [allVouches, setAllVouches] = useState<VouchWithLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [visibleRings, setVisibleRings] = useState<Record<number, boolean>>({
    1: true, // Ring 1 always visible
    2: false, // Only enable first ring initially
    3: false,
  });
  const { theme } = useTheme();

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

    const fetchVouches = async () => {
      if (!profileId) {
        setError("Profile ID not available");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const allVouchesWithLevels: VouchWithLevel[] = [];
        const processedProfileIds = new Set<number>([profileId]);
        const profileIdsToProcess = [profileId];

        // Fetch level 1 vouches
        const givenResponse = await fetch(
          "https://api.ethos.network/api/v2/vouches",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({
              authorProfileIds: [profileId],
              limit: 100,
            }),
          }
        );

        const receivedResponse = await fetch(
          "https://api.ethos.network/api/v2/vouches",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({
              subjectProfileIds: [profileId],
              limit: 100,
            }),
          }
        );

        if (!givenResponse.ok || !receivedResponse.ok) {
          setError("Failed to fetch vouches");
          return;
        }

        const givenData: VouchesResponse = await givenResponse.json();
        const receivedData: VouchesResponse = await receivedResponse.json();

        // Add level 1 vouches (limit to MAX_LEVEL_1_NODES)
        const level1Given = (givenData.values || []).slice(0, MAX_LEVEL_1_NODES);
        const level1Received = (receivedData.values || []).slice(0, MAX_LEVEL_1_NODES);
        
        level1Given.forEach((vouch) => {
          if (allVouchesWithLevels.length >= MAX_TOTAL_NODES) return;
          allVouchesWithLevels.push({ ...vouch, level: 1 });
          if (vouch.subjectProfileId && !processedProfileIds.has(vouch.subjectProfileId)) {
            profileIdsToProcess.push(vouch.subjectProfileId);
            processedProfileIds.add(vouch.subjectProfileId);
          }
        });

        level1Received.forEach((vouch) => {
          if (allVouchesWithLevels.length >= MAX_TOTAL_NODES) return;
          allVouchesWithLevels.push({ ...vouch, level: 1 });
          if (vouch.authorProfileId && !processedProfileIds.has(vouch.authorProfileId)) {
            profileIdsToProcess.push(vouch.authorProfileId);
            processedProfileIds.add(vouch.authorProfileId);
          }
        });

        // Set level 1 data first for immediate display
        setAllVouches(allVouchesWithLevels);
        setLoading(false);

        // Fetch level 2 data in background (progressive loading)
        const level2ProfileIds = profileIdsToProcess.slice(1, MAX_LEVEL_2_PROFILES_TO_FETCH + 1);
        
        // Parallelize all level 2 API calls
        const level2Promises = level2ProfileIds.map(async (pid) => {
          try {
            const [level2Given, level2Received] = await Promise.all([
              fetch("https://api.ethos.network/api/v2/vouches", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Ethos-Client": "ethos-scanner@0.1.0",
                },
                body: JSON.stringify({
                  authorProfileIds: [pid],
                  limit: MAX_LEVEL_2_NODES_PER_PROFILE,
                }),
              }),
              fetch("https://api.ethos.network/api/v2/vouches", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Ethos-Client": "ethos-scanner@0.1.0",
                },
                body: JSON.stringify({
                  subjectProfileIds: [pid],
                  limit: MAX_LEVEL_2_NODES_PER_PROFILE,
                }),
              }),
            ]);

            const results: VouchWithLevel[] = [];

            if (level2Given.ok) {
              const data: VouchesResponse = await level2Given.json();
              const level2Vouches = (data.values || []).slice(0, MAX_LEVEL_2_NODES_PER_PROFILE);
              level2Vouches.forEach((vouch) => {
                results.push({ ...vouch, level: 2 });
              });
            }

            if (level2Received.ok) {
              const data: VouchesResponse = await level2Received.json();
              const level2Vouches = (data.values || []).slice(0, MAX_LEVEL_2_NODES_PER_PROFILE);
              level2Vouches.forEach((vouch) => {
                results.push({ ...vouch, level: 2 });
              });
            }

            return results;
          } catch (e) {
            return [];
          }
        });

        // Wait for all level 2 calls and update
        const level2Results = await Promise.all(level2Promises);
        const level2Vouches = level2Results.flat().slice(0, MAX_TOTAL_NODES - allVouchesWithLevels.length);
        
        // Update with combined data
        setAllVouches([...allVouchesWithLevels, ...level2Vouches]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch vouches"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchVouches();
  }, [profileId, mounted]);

  // Toggle ring visibility with auto-enable logic
  const toggleRing = (ring: number) => {
    if (ring === 1) return; // Ring 1 cannot be toggled
    
    setVisibleRings((prev) => {
      const newState = { ...prev };
      
      // If enabling ring 3 and ring 2 is not enabled, auto-enable ring 2
      if (ring === 3 && !prev[2]) {
        newState[2] = true;
      }
      
      newState[ring] = !prev[ring];
      return newState;
    });
  };

  useEffect(() => {
    if (
      !mounted ||
      !svgRef.current ||
      loading ||
      allVouches.length === 0
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
      const maxLevel = Math.max(...allVouches.map((v) => v.level), 1);
      height = Math.max(600, Math.min(allVouches.length * 15 + 300, 800));
    }
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

    // Create a container group for pan/zoom
    const g = svg.append("g").attr("class", "zoom-container");

    // Create dot grid pattern for background
    const defs = svg.append("defs");
    const isDarkMode = theme === "dark";
    const dotColor = isDarkMode ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)";
    const dotSize = 2;
    const dotSpacing = 20;

    const pattern = defs
      .append("pattern")
      .attr("id", "dot-grid-vouches")
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
      .attr("fill", "url(#dot-grid-vouches)")
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
      vouchType: "root",
      level: 0,
    };

    // Create nodes map
    const nodeMap = new Map<string, Node>();
    nodeMap.set(rootId, rootNode);

    // Process all vouches with levels
    // Use a map to track the minimum level for each user
    const userMinLevels = new Map<string, number>();
    
    allVouches.forEach((vouch) => {
      // Track minimum level for each user
      if (vouch.subjectProfileId) {
        const subjectId = vouch.subjectProfileId.toString();
        const currentMin = userMinLevels.get(subjectId);
        if (currentMin === undefined || vouch.level < currentMin) {
          userMinLevels.set(subjectId, vouch.level);
        }
      }
      if (vouch.authorProfileId && vouch.authorProfileId !== profileId) {
        const authorId = vouch.authorProfileId.toString();
        const currentMin = userMinLevels.get(authorId);
        if (currentMin === undefined || vouch.level < currentMin) {
          userMinLevels.set(authorId, vouch.level);
        }
      }
    });

    // Create nodes with minimum level (ensures each user appears only once)
    allVouches.forEach((vouch) => {
      // Process subject (for vouches given)
      if (vouch.subjectProfileId) {
        const subjectId = vouch.subjectProfileId.toString();
        if (!nodeMap.has(subjectId)) {
          const minLevel = userMinLevels.get(subjectId) || vouch.level;
          nodeMap.set(subjectId, {
            id: subjectId,
            profileId: vouch.subjectProfileId,
            name: vouch.subjectUser.displayName,
            username: vouch.subjectUser.username,
            avatarUrl: vouch.subjectUser.avatarUrl,
            score: vouch.subjectUser.score,
            isRoot: false,
            vouchType: vouch.authorProfileId === profileId ? "received" : "given",
            level: minLevel,
          });
        } else {
          const node = nodeMap.get(subjectId)!;
          // Update to minimum level if this connection has a lower level
          const minLevel = userMinLevels.get(subjectId) || node.level;
          if (minLevel < node.level) {
            node.level = minLevel;
          }
          if (node.vouchType !== "both") {
            node.vouchType = "both";
          }
        }
      }

      // Process author (for vouches received)
      if (vouch.authorProfileId && vouch.authorProfileId !== profileId) {
        const authorId = vouch.authorProfileId.toString();
        if (!nodeMap.has(authorId)) {
          const minLevel = userMinLevels.get(authorId) || vouch.level;
          nodeMap.set(authorId, {
            id: authorId,
            profileId: vouch.authorProfileId,
            name: vouch.authorUser.displayName,
            username: vouch.authorUser.username,
            avatarUrl: vouch.authorUser.avatarUrl,
            score: vouch.authorUser.score,
            isRoot: false,
            vouchType: vouch.subjectProfileId === profileId ? "given" : "received",
            level: minLevel,
          });
        } else {
          const node = nodeMap.get(authorId)!;
          // Update to minimum level if this connection has a lower level
          const minLevel = userMinLevels.get(authorId) || node.level;
          if (minLevel < node.level) {
            node.level = minLevel;
          }
          if (node.vouchType !== "both") {
            node.vouchType = "both";
          }
        }
      }
    });

    // Filter nodes and links based on visible rings
    // A node is visible if its level is visible OR if it's needed to connect visible nodes
    const allNodes = Array.from(nodeMap.values());
    
    // First, filter nodes by visible rings (but keep root and level 1 always)
    const filteredNodesByRing = allNodes.filter((node) => {
      if (node.isRoot || node.level === 0) return true; // Root always visible
      if (node.level === 1) return visibleRings[1] ?? true; // Level 1 always visible (but check anyway)
      return visibleRings[node.level] ?? false;
    });
    
    // Get all node IDs that should be visible (including intermediate nodes needed for connections)
    const visibleNodeIds = new Set(filteredNodesByRing.map(n => n.id));
    
    // Find all nodes that are needed to connect visible nodes
    // If a link connects two visible nodes, both endpoints must be visible
    const neededNodeIds = new Set<string>();
    allVouches.forEach((vouch) => {
      const sourceId = vouch.authorProfileId.toString();
      const targetId = vouch.subjectProfileId.toString();
      
      // Check if this link should be visible based on ring visibility
      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);
      
      if (!sourceNode || !targetNode) return;
      
      // Link is visible if target level is visible (or source is root/level 1)
      const linkVisible = sourceNode.isRoot || sourceNode.level === 0 || 
                         (sourceNode.level === 1 && (visibleRings[1] ?? true)) ||
                         (visibleRings[sourceNode.level] ?? false);
      const targetVisible = targetNode.isRoot || targetNode.level === 0 ||
                           (targetNode.level === 1 && (visibleRings[1] ?? true)) ||
                           (visibleRings[targetNode.level] ?? false);
      
      if (linkVisible && targetVisible) {
        neededNodeIds.add(sourceId);
        neededNodeIds.add(targetId);
      }
    });
    
    // Combine filtered nodes with needed nodes
    const finalNodeIds = new Set([...visibleNodeIds, ...neededNodeIds]);
    const nodes: Node[] = allNodes
      .filter((node) => finalNodeIds.has(node.id))
      .slice(0, MAX_TOTAL_NODES);
    const nodeIds = new Set(nodes.map(n => n.id));

    const links: Link[] = allVouches.flatMap((vouch) => {
      const sourceId = vouch.authorProfileId.toString();
      const targetId = vouch.subjectProfileId.toString();
    
      // Only include if both endpoints are in the rendered set
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];
      
      // Check if this link should be visible based on ring visibility
      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);
      
      if (!sourceNode || !targetNode) return [];
      
      // Link is visible if target level is visible (or source is root/level 1)
      const sourceVisible = sourceNode.isRoot || sourceNode.level === 0 ||
                           (sourceNode.level === 1 && (visibleRings[1] ?? true)) ||
                           (visibleRings[sourceNode.level] ?? false);
      const targetVisible = targetNode.isRoot || targetNode.level === 0 ||
                           (targetNode.level === 1 && (visibleRings[1] ?? true)) ||
                           (visibleRings[targetNode.level] ?? false);
      
      if (!sourceVisible || !targetVisible) return [];
    
      const amount = vouch.balance ? Number.parseFloat(vouch.balance) / 1e18 : undefined;
    
      return [
        {
          source: sourceId,
          target: targetId,
          amount,
        },
      ];
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
      .attr("stroke", (d) => {
        const target = d.target as Node;
        return getNodeColor(target);
      })
      .attr("stroke-opacity", (d) => {
        const target = d.target as Node;
        return 0.4 + (1 - target.level * 0.1);
      })
      .attr("stroke-width", (d) => {
        const target = d.target as Node;
        const baseWidth = d.amount 
          ? Math.max(1, Math.min(5, Math.log10(d.amount + 1) * 1.5))
          : 2;
        return Math.max(1, baseWidth - target.level * 0.3);
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
      .attr("clip-path", (d) => `url(#clip-vouches-${d.id})`)
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
        .attr("id", `clip-vouches-${node.id}`)
        .append("circle")
        .attr("r", radius);
    });

    // Get theme-aware colors
    const isDarkTheme = theme === "dark";
    const getTextColor = () => {
      return isDarkTheme ? "hsl(0, 0%, 98%)" : "hsl(0, 0%, 15%)";
    };

    const getMutedColor = () => {
      return isDarkTheme ? "hsl(0, 0%, 70%)" : "hsl(0, 0%, 45%)";
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
    allVouches.length,
    loading,
    userId,
    profileId,
    userName,
    mounted,
    isFullscreen,
    theme,
    visibleRings,
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
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (allVouches.length === 0) {
    return (
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        No vouches found for this user.
      </div>
    );
  }

  // Count vouches by level
  const levelCounts = allVouches.reduce((acc, vouch) => {
    acc[vouch.level] = (acc[vouch.level] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const levelLabels: Record<number, string> = {
    1: "1st ring",
    2: "2nd ring",
    3: "3rd ring",
  };

  const resetView = () => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      const initialTransform = d3.zoomIdentity;
      svg.transition().duration(750).call(zoomRef.current.transform, initialTransform);
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
                  Showing {allVouches.length} vouch{allVouches.length !== 1 ? "es" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                  {allVouches.length >= MAX_TOTAL_NODES && (
                    <span className="text-xs ml-2">(limited for performance)</span>
                  )}
                </div>
                <div className="flex gap-4 flex-wrap">
                  {Object.entries(levelCounts).map(([level, count]) => {
                    const levelNum = parseInt(level);
                    const isVisible = levelNum === 1 ? true : visibleRings[levelNum] ?? false;
                    const isClickable = levelNum !== 1;
                    
                    return (
                      <span 
                        key={level} 
                        className={`inline-flex items-center gap-1 ${isClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                        onClick={isClickable ? () => toggleRing(levelNum) : undefined}
                        title={isClickable ? `Click to ${isVisible ? 'hide' : 'show'} ${levelLabels[levelNum] || `Level ${level}`}` : undefined}
                      >
                        <span 
                          className="inline-block w-3 h-3 rounded-full" 
                          style={{ 
                            backgroundColor: level === "0" ? "#3b82f6" : 
                                            level === "1" ? "#10b981" : 
                                            level === "2" ? "#f59e0b" : "#ef4444",
                            opacity: isVisible ? 1 : 0.3
                          }}
                        />
                        <span style={{ opacity: isVisible ? 1 : 0.5 }}>
                          {levelLabels[levelNum] || `Level ${level}`}: {count}
                        </span>
                      </span>
                    );
                  })}
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
                Showing {allVouches.length} vouch{allVouches.length !== 1 ? "es" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                {allVouches.length >= MAX_TOTAL_NODES && (
                  <span className="text-xs ml-2">(limited for performance)</span>
                )}
              </div>
              <div className="flex gap-4 flex-wrap">
                {Object.entries(levelCounts).map(([level, count]) => {
                  const levelNum = parseInt(level);
                  const isVisible = levelNum === 1 ? true : visibleRings[levelNum] ?? false;
                  const isClickable = levelNum !== 1;
                  
                  return (
                    <span 
                      key={level} 
                      className={`inline-flex items-center gap-1 ${isClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                      onClick={isClickable ? () => toggleRing(levelNum) : undefined}
                      title={isClickable ? `Click to ${isVisible ? 'hide' : 'show'} ${levelLabels[levelNum] || `Level ${level}`}` : undefined}
                    >
                      <span 
                        className="inline-block w-3 h-3 rounded-full" 
                        style={{ 
                          backgroundColor: level === "0" ? "#3b82f6" : 
                                          level === "1" ? "#10b981" : 
                                          level === "2" ? "#f59e0b" : "#ef4444",
                          opacity: isVisible ? 1 : 0.3
                        }}
                      />
                      <span style={{ opacity: isVisible ? 1 : 0.5 }}>
                        {levelLabels[levelNum] || `Level ${level}`}: {count}
                      </span>
                    </span>
                  );
                })}
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

