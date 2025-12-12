"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2 } from "lucide-react";

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
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Ensure component only renders after client-side hydration
  useEffect(() => {
    setMounted(true);
  }, []);

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
        if (json.values && Array.isArray(json.values)) {
          setInvitations(json.values);
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
    const width = container ? Math.min(container.clientWidth - 32, 1000) : 1000;
    const maxLevel = Math.max(...invitations.map((inv) => inv.level), 1);
    const height = Math.max(600, Math.min(invitations.length * 40 + 300, 800));
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

    invitations.forEach((invitation) => {
      // Add the invitee node
      const nodeId = invitation.user.profileId?.toString() || invitation.user.id.toString();
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          id: nodeId,
          profileId: invitation.user.profileId,
          name: invitation.user.displayName,
          username: invitation.user.username,
          avatarUrl: invitation.user.avatarUrl,
          score: invitation.user.score,
          isRoot: false,
          level: invitation.level,
        });
      }
      
      // Ensure sender node exists (might be root or another invitee)
      const senderId = invitation.senderProfileId.toString();
      if (!nodeMap.has(senderId) && senderId !== rootId) {
        // Find the sender in invitations to get their level
        const senderInvitation = invitations.find(
          (inv) => (inv.user.profileId?.toString() || inv.user.id.toString()) === senderId
        );
        const senderLevel = senderInvitation ? senderInvitation.level - 1 : 0;
        // Create a placeholder node for the sender if not found
        nodeMap.set(senderId, {
          id: senderId,
          profileId: invitation.senderProfileId,
          name: `User ${senderId}`,
          username: null,
          avatarUrl: "",
          score: 0,
          isRoot: false,
          level: senderLevel,
        });
      }
    });

    const nodes: Node[] = Array.from(nodeMap.values());

    // Create links based on sender -> accepted relationships
    const links: Link[] = invitations
      .map((invitation) => {
        const sourceId = invitation.senderProfileId.toString();
        const targetId = invitation.user.profileId?.toString() || invitation.user.id.toString();
        // Only create link if both nodes exist
        if (nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          return {
            source: sourceId,
            target: targetId,
          };
        }
        return null;
      })
      .filter((link): link is Link => link !== null);

    // Color scheme for different levels
    const levelColors: Record<number, string> = {
      0: "#3b82f6", // Root - blue
      1: "#10b981", // Level 1 - green
      2: "#f59e0b", // Level 2 - orange
      3: "#ef4444", // Level 3 - red
    };

    const getLevelColor = (level: number) => levelColors[level] || "#64748b";

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

    svg
      .call(zoom)
      .style("cursor", "grab")
      .on("dblclick.zoom", null); // Disable double-click zoom

    // Create force simulation with radial positioning for levels
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<Node, Link>(links)
          .id((d) => d.id)
          .distance((d) => {
            const source = d.source as Node;
            const target = d.target as Node;
            const levelDiff = Math.abs(target.level - source.level);
            // Increase distance for higher levels
            return 100 + levelDiff * 50;
          })
      )
      .force("charge", d3.forceManyBody().strength((d) => {
        const node = d as Node;
        // Reduce charge strength for higher levels to create rings
        return node.isRoot ? -500 : -200 / (node.level + 1);
      }))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d) => {
          const node = d as Node;
          return node.isRoot ? 40 : Math.max(20, 25 - node.level * 3);
        })
      )
      .force("radial", d3.forceRadial((d) => {
        const node = d as Node;
        // Create concentric rings based on level
        const baseRadius = 80;
        return baseRadius + node.level * 120;
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
        const target = d.target as Node;
        const color = getLevelColor(target.level);
        return color;
      })
      .attr("stroke-opacity", (d) => {
        const target = d.target as Node;
        // Fade links for higher levels
        return 0.4 + (1 - target.level * 0.1);
      })
      .attr("stroke-width", (d) => {
        const target = d.target as Node;
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
          .on("drag", function(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
          })
          .on("end", function(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
          })
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
        const baseOffset = 35;
        const radius = Math.max(18, 25 - d.level * 2);
        return baseOffset + radius;
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
        const baseOffset = 50;
        const radius = Math.max(18, 25 - d.level * 2);
        return baseOffset + radius;
      })
      .attr("text-anchor", "middle")
      .attr("fill", getMutedColor())
      .attr("font-size", (d) => `${Math.max(8, 10 - d.level * 0.3)}px`)
      .text((d) => (d.score > 0 ? `Score: ${d.score}` : ""));

    // Update positions on simulation tick
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

    return () => {
      simulation.stop();
    };
  }, [invitations, loading, userId, profileId, userName, mounted]);

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

  return (
    <div className="w-full overflow-auto rounded-lg border bg-background p-4">
      <div className="text-sm text-muted-foreground mb-2 space-y-1">
        <div>
          Showing {invitations.length} invitee{invitations.length !== 1 ? "s" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
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
      <svg ref={svgRef} className="w-full h-auto" style={{ shapeRendering: "geometricPrecision" }}></svg>
    </div>
  );
}

