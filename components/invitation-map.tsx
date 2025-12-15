"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Invitee {
  id: number;
  profileId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  score: number;
}

interface Invitation {
  id: number;
  senderProfileId: number;
  acceptedProfileId: number;
  level: number;
  user: Invitee;
}

interface InvitationResponse {
  values: Invitation[];
}

interface InvitationMapProps {
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
  level: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

export function InvitationMap({ userId, profileId, userName, avatarUrl = "" }: InvitationMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Ensure component only renders after client-side hydration
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
    
    const fetchInvitees = async () => {
      if (!profileId) {
        setError("Profile ID not available");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const endpoint = `https://api.ethos.network/api/v2/invitations/accepted/${profileId}/tree`;

        const response = await fetch(endpoint, {
          headers: {
            "X-Ethos-Client": "ethos-scanner@0.1.0",
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setError("No invitations found for this user");
          } else {
            setError(`Failed to fetch invitations: ${response.statusText}`);
          }
          return;
        }

        const json: InvitationResponse = await response.json();
        
        // Store full invitation data with level information
        // Limit total nodes for performance (max 200 nodes total)
        if (json.values && Array.isArray(json.values)) {
          const limitedInvitations = json.values.slice(0, 200);
          setInvitations(limitedInvitations);
        } else {
          setError("Invalid response format");
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch invitations"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchInvitees();
  }, [profileId, mounted]);

  useEffect(() => {
    if (!mounted || !svgRef.current || loading || invitations.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Add xlink namespace for image href compatibility
    if (!svgRef.current.hasAttribute("xmlns:xlink")) {
      svgRef.current.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    }

    // Get container dimensions
    const container = svgRef.current.parentElement;
    let width: number;
    let height: number;
    
    if (isFullscreen) {
      // Use viewport dimensions in fullscreen mode
      width = window.innerWidth - 64; // Account for padding (32px * 2)
      height = window.innerHeight - 200; // Account for header and padding
    } else {
      width = container ? Math.min(container.clientWidth - 32, 1000) : 1000;
      const maxLevel = Math.max(...invitations.map((inv) => inv.level), 1);
      height = Math.max(600, Math.min(invitations.length * 15 + 300, 800));
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
      .attr("id", "dot-grid")
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
    // Make it much larger to cover the entire pannable area
    const bgSize = Math.max(width, height) * 5; // 5x the viewport size
    g.append("rect")
      .attr("width", bgSize)
      .attr("height", bgSize)
      .attr("fill", "url(#dot-grid)")
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
      level: 0,
    };

    // Create nodes for all invitees with level information
    const nodeMap = new Map<string, Node>();
    nodeMap.set(rootId, rootNode);

    // First pass: track minimum level for each user
    const userMinLevels = new Map<string, number>();
    
    invitations.forEach((invitation) => {
      const nodeId = invitation.user.profileId?.toString() || invitation.user.id.toString();
      const currentMin = userMinLevels.get(nodeId);
      if (currentMin === undefined || invitation.level < currentMin) {
        userMinLevels.set(nodeId, invitation.level);
      }
      
      // Also track sender levels
      const senderId = invitation.senderProfileId.toString();
      if (senderId !== rootId) {
        const senderInvitation = invitations.find(
          (inv) => (inv.user.profileId?.toString() || inv.user.id.toString()) === senderId
        );
        const senderLevel = senderInvitation ? senderInvitation.level - 1 : invitation.level - 1;
        const senderCurrentMin = userMinLevels.get(senderId);
        if (senderCurrentMin === undefined || senderLevel < senderCurrentMin) {
          userMinLevels.set(senderId, senderLevel);
        }
      }
    });

    // Second pass: create nodes with minimum level (ensures each user appears only once)
    invitations.forEach((invitation) => {
      // Add the invitee node
      const nodeId = invitation.user.profileId?.toString() || invitation.user.id.toString();
      if (!nodeMap.has(nodeId)) {
        const minLevel = userMinLevels.get(nodeId) || invitation.level;
        nodeMap.set(nodeId, {
          id: nodeId,
          profileId: invitation.user.profileId,
          name: invitation.user.displayName,
          username: invitation.user.username,
          avatarUrl: invitation.user.avatarUrl,
          score: invitation.user.score,
          isRoot: false,
          level: minLevel,
        });
      } else {
        // Update to minimum level if this connection has a lower level
        const node = nodeMap.get(nodeId)!;
        const minLevel = userMinLevels.get(nodeId) || node.level;
        if (minLevel < node.level) {
          node.level = minLevel;
        }
      }
      
      // Ensure sender node exists (might be root or another invitee)
      const senderId = invitation.senderProfileId.toString();
      if (!nodeMap.has(senderId) && senderId !== rootId) {
        // Find the sender in invitations to get their level
        const senderInvitation = invitations.find(
          (inv) => (inv.user.profileId?.toString() || inv.user.id.toString()) === senderId
        );
        const senderLevel = senderInvitation ? senderInvitation.level - 1 : invitation.level - 1;
        const minLevel = userMinLevels.get(senderId) || senderLevel;
        
        // Try to get user info from the invitation if available
        const senderUserInfo = senderInvitation?.user;
        nodeMap.set(senderId, {
          id: senderId,
          profileId: invitation.senderProfileId,
          name: senderUserInfo?.displayName || `User ${senderId}`,
          username: senderUserInfo?.username || null,
          avatarUrl: senderUserInfo?.avatarUrl || "",
          score: senderUserInfo?.score || 0,
          isRoot: false,
          level: minLevel,
        });
      } else if (nodeMap.has(senderId) && senderId !== rootId) {
        // Update sender node to minimum level if needed
        const node = nodeMap.get(senderId)!;
        const minLevel = userMinLevels.get(senderId);
        if (minLevel !== undefined && minLevel < node.level) {
          node.level = minLevel;
        }
      }
    });

    // Limit nodes for performance (safety check)
    const allNodes = Array.from(nodeMap.values());
    const nodes: Node[] = allNodes.slice(0, 200);
    const nodeIds = new Set(nodes.map(n => n.id));

    // Create links based on sender -> accepted relationships
    // Only include links between nodes that are actually rendered
    const links = invitations
      .map((invitation) => {
        const sourceId = invitation.senderProfileId.toString();
        const targetId = invitation.user.profileId?.toString() || invitation.user.id.toString();
        // Only create link if both nodes exist and are in the rendered set
        if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
          return {
            source: sourceId,
            target: targetId,
          };
        }
        return undefined;
      })
      .filter((link): link is { source: string; target: string } => !!link);

    // Color scheme for different levels
    const levelColors: Record<number, string> = {
      0: "#3b82f6", // Root - blue
      1: "#10b981", // Level 1 - green
      2: "#f59e0b", // Level 2 - orange
      3: "#ef4444", // Level 3 - red
    };

    const getLevelColor = (level: number) => levelColors[level] || "#64748b";

    // Create a helper to safely get Node from Link source/target
    const getNode = (nodeOrId: string | Node): Node => {
      if (typeof nodeOrId === 'string') {
        return nodeMap.get(nodeOrId)!;
      }
      return nodeOrId;
    };

    // Set up zoom behavior with limited zoom out to prevent map from disappearing
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4]) // Minimum zoom is 50% to prevent map from disappearing
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
      .on("dblclick.zoom", null); // Disable double-click zoom

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
            const source = getNode(d.source);
            const target = getNode(d.target);
            const levelDiff = Math.abs(target.level - source.level);
            // Increase distance for higher levels with more breathing room
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

    // Create links with different styles based on level
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", (d) => {
        const target = getNode(d.target);
        const color = getLevelColor(target.level);
        return color;
      })
      .attr("stroke-opacity", (d) => {
        const target = getNode(d.target);
        // Fade links for higher levels
        return 0.4 + (1 - target.level * 0.1);
      })
      .attr("stroke-width", (d) => {
        const target = getNode(d.target);
        // Thinner lines for higher levels
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

    // Add circles for nodes with level-based colors and sizes
    nodeGroups
      .append("circle")
      .attr("r", (d) => {
        if (d.isRoot) return 35;
        // Smaller nodes for higher levels
        return Math.max(18, 25 - d.level * 2);
      })
      .attr("fill", (d) => getLevelColor(d.level))
      .attr("stroke", "#fff")
      .attr("stroke-width", (d) => (d.isRoot ? 3 : 2))
      .attr("opacity", (d) => (d.isRoot ? 1 : 0.9 - d.level * 0.1));

    // Add images for avatars with level-based sizing
    const images = nodeGroups
      .append("image")
      .attr("xlink:href", (d) => d.avatarUrl || "")
      .attr("href", (d) => d.avatarUrl || "") // Fallback for SVG 2
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
      .attr("clip-path", (d) => `url(#clip-${d.id})`)
      .style("opacity", (d) => (d.avatarUrl ? 1 : 0))
      .on("error", function() {
        // Hide image if it fails to load
        d3.select(this).style("opacity", 0);
      });

    // Add clip paths for circular avatars with level-based sizing
    // Use the existing defs from the SVG root (created earlier for dot grid)
    nodes.forEach((node) => {
      const radius = node.isRoot 
        ? 30 
        : Math.max(15, 20 - node.level * 2.5);
      const clipPath = defs
        .append("clipPath")
        .attr("id", `clip-${node.id}`);
      clipPath
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
    const labels = nodeGroups
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

    // Update positions on simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => getNode(d.source).x ?? 0)
        .attr("y1", (d) => getNode(d.source).y ?? 0)
        .attr("x2", (d) => getNode(d.target).x ?? 0)
        .attr("y2", (d) => getNode(d.target).y ?? 0);

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
  }, [invitations, loading, userId, profileId, userName, mounted, isFullscreen]);

  // Don't render until mounted to prevent hydration mismatch
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

  if (invitations.length === 0) {
    return (
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        No invitations found for this user.
      </div>
    );
  }

  // Count invitations by level
  const levelCounts = invitations.reduce((acc, inv) => {
    acc[inv.level] = (acc[inv.level] || 0) + 1;
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
                  Showing {invitations.length} invitee{invitations.length !== 1 ? "s" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                  {invitations.length >= 200 && (
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
              Showing {invitations.length} invitee{invitations.length !== 1 ? "s" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
              {invitations.length >= 200 && (
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

