"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import {
  getCachedData,
  setCachedData,
  getVouchesCacheKey,
  CacheDurations,
} from "@/lib/cache";
import { useRouter } from "next/navigation";

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
  level: number; // The level of this vouch relationship
  isReciprocal?: boolean; // Whether this vouch is reciprocated
}

interface VouchWithLevel extends Vouch {
  level: number;
}

// Performance limits
const MAX_LEVEL_1_NODES = 50;
const MAX_TOTAL_NODES = 200;
const MAX_TOTAL_VOUCHES = 500; // Max total vouches to fetch and display

// Helper function to check if a vouch is funded (has a balance > 0)
const isVouchFunded = (vouch: Vouch): boolean => {
  if (!vouch.balance) return false;
  try {
    const balance = Number.parseFloat(vouch.balance);
    return balance > 0;
  } catch {
    return false;
  }
};

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
  const router = useRouter();

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

      // Try to get from cache first
      const givenCacheKey = getVouchesCacheKey(profileId, "given");
      const receivedCacheKey = getVouchesCacheKey(profileId, "received");
      
      const cachedGiven = getCachedData<VouchesResponse>(
        givenCacheKey,
        CacheDurations.VOUCHES
      );
      const cachedReceived = getCachedData<VouchesResponse>(
        receivedCacheKey,
        CacheDurations.VOUCHES
      );

      // If we have cached data, use it and continue with level 2 fetching
      let givenData: VouchesResponse;
      let receivedData: VouchesResponse;

      if (cachedGiven && cachedReceived) {
        givenData = cachedGiven;
        receivedData = cachedReceived;
      } else {
        // Fetch from API if not fully cached
        setLoading(true);
        setError(null);

        try {
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

          givenData = await givenResponse.json();
          receivedData = await receivedResponse.json();

          // Cache the responses
          setCachedData(givenCacheKey, givenData);
          setCachedData(receivedCacheKey, receivedData);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch vouches"
          );
          setLoading(false);
          return;
        }
      }

      // Set loading if we're fetching from API, otherwise process cached data
      if (!cachedGiven || !cachedReceived) {
        setLoading(true);
      }

      try {
        const allVouchesWithLevels: VouchWithLevel[] = [];
        const processedProfileIds = new Set<number>([profileId]);
        const profileIdsToProcess = [profileId];

        // Add level 1 vouches (limit to MAX_LEVEL_1_NODES) - only funded vouches
        const level1Given = (givenData.values || []).filter(isVouchFunded).slice(0, MAX_LEVEL_1_NODES);
        const level1Received = (receivedData.values || []).filter(isVouchFunded).slice(0, MAX_LEVEL_1_NODES);
        
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

        // Get all level 1 profile IDs (excluding root)
        const level1ProfileIds = Array.from(new Set([
          ...level1Given.map(v => v.subjectProfileId),
          ...level1Received.map(v => v.authorProfileId)
        ].filter(id => id !== profileId)));

        // STEP 1: Fetch ALL vouches between first-ring nodes for complete picture
        const level1InterConnectionPromises = level1ProfileIds.map(async (pid) => {
          try {
            const response = await fetch("https://api.ethos.network/api/v2/vouches", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Ethos-Client": "ethos-scanner@0.1.0",
              },
              body: JSON.stringify({
                authorProfileIds: [pid],
                limit: 100, // Get all connections for this profile
              }),
            });

            if (!response.ok) return [];

            const data: VouchesResponse = await response.json();
            const results: VouchWithLevel[] = [];

            // Only include funded vouches to other level 1 nodes
            (data.values || []).forEach((vouch) => {
              if (isVouchFunded(vouch) && level1ProfileIds.includes(vouch.subjectProfileId)) {
                results.push({ ...vouch, level: 1 }); // Mark as level 1 (first-ring connection)
              }
            });

            return results;
          } catch (e) {
            return [];
          }
        });

        // Wait for all level 1 inter-connection calls
        const level1InterConnectionResults = await Promise.all(level1InterConnectionPromises);
        const level1InterConnections = level1InterConnectionResults.flat();
        
        // Combine level 1 direct connections + inter-connections
        const allLevel1Vouches = [...allVouchesWithLevels, ...level1InterConnections];
        
        // Count unique nodes in level 1
        const level1NodeIds = new Set<number>();
        allLevel1Vouches.forEach((vouch) => {
          if (vouch.authorProfileId !== profileId) level1NodeIds.add(vouch.authorProfileId);
          if (vouch.subjectProfileId !== profileId) level1NodeIds.add(vouch.subjectProfileId);
        });

        // Update with complete level 1 data
        setAllVouches(allLevel1Vouches.slice(0, MAX_TOTAL_VOUCHES));

        // Check if we have capacity for level 2
        const remainingCapacity = MAX_TOTAL_NODES - level1NodeIds.size - 1; // -1 for root
        if (remainingCapacity <= 5) {
          // Not enough capacity for meaningful level 2, stop here
          return;
        }

        // STEP 2: Fetch level 2 nodes (only a subset of level 1 profiles)
        const level2ProfileIds = Array.from(level1NodeIds).slice(0, 10);
        
        const level2Promises = level2ProfileIds.map(async (pid) => {
          try {
            const response = await fetch("https://api.ethos.network/api/v2/vouches", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Ethos-Client": "ethos-scanner@0.1.0",
              },
              body: JSON.stringify({
                authorProfileIds: [pid],
                limit: 100,
              }),
            });

            if (!response.ok) return [];

            const data: VouchesResponse = await response.json();
            const results: VouchWithLevel[] = [];

            (data.values || []).forEach((vouch) => {
              // Skip if this is a connection to level 1 or root (already captured)
              if (level1ProfileIds.includes(vouch.subjectProfileId) || vouch.subjectProfileId === profileId) return;
              // Only include funded vouches
              if (!isVouchFunded(vouch)) return;
              results.push({ ...vouch, level: 2 });
            });

            return results;
          } catch (e) {
            return [];
          }
        });

        const level2Results = await Promise.all(level2Promises);
        let level2Vouches = level2Results.flat();

        // Get level 2 profile IDs
        const level2NodeIds = new Set<number>();
        level2Vouches.forEach((vouch) => {
          if (vouch.subjectProfileId !== profileId && !level1ProfileIds.includes(vouch.subjectProfileId)) {
            level2NodeIds.add(vouch.subjectProfileId);
          }
        });

        // STEP 3: Fetch inter-connections between level 2 nodes
        const level2InterConnectionPromises = Array.from(level2NodeIds).map(async (pid) => {
          try {
            const response = await fetch("https://api.ethos.network/api/v2/vouches", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Ethos-Client": "ethos-scanner@0.1.0",
              },
              body: JSON.stringify({
                authorProfileIds: [pid],
                limit: 50,
              }),
            });

            if (!response.ok) return [];

            const data: VouchesResponse = await response.json();
            const results: VouchWithLevel[] = [];

            // Only include funded vouches to other level 2 nodes
            (data.values || []).forEach((vouch) => {
              if (isVouchFunded(vouch) && level2NodeIds.has(vouch.subjectProfileId)) {
                results.push({ ...vouch, level: 2 }); // Mark as level 2 (second-ring connection)
              }
            });

            return results;
          } catch (e) {
            return [];
          }
        });

        const level2InterConnectionResults = await Promise.all(level2InterConnectionPromises);
        const level2InterConnections = level2InterConnectionResults.flat();

        // Combine all vouches and limit to capacity
        const allVouchesComplete = [...allLevel1Vouches, ...level2Vouches, ...level2InterConnections];
        setAllVouches(allVouchesComplete.slice(0, MAX_TOTAL_VOUCHES));
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
      // On small screens (below md breakpoint), make it square
      if (window.innerWidth < 768) {
        height = width;
      } else {
        // On desktop, use 60% of viewport height
        height = Math.floor(window.innerHeight * 0.6);
      }
    }
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

    // Create a container group for pan/zoom
    const g = svg.append("g").attr("class", "zoom-container");

    // Create plus pattern for background
    const defs = svg.append("defs");
    const isDarkMode = theme === "dark";
    const plusColor = isDarkMode ? "#1a1a1a" : "#e5e5e5";
    const plusSize = 8; // Size of the plus sign
    const plusThickness = 1; // Thickness of the plus lines
    const plusSpacing = 50;

    const pattern = defs
      .append("pattern")
      .attr("id", "dot-grid-vouches")
      .attr("width", plusSpacing)
      .attr("height", plusSpacing)
      .attr("patternUnits", "userSpaceOnUse");

    // Vertical line of the plus
    pattern
      .append("rect")
      .attr("x", plusSpacing / 2 - plusThickness / 2)
      .attr("y", plusSpacing / 2 - plusSize / 2)
      .attr("width", plusThickness)
      .attr("height", plusSize)
      .attr("fill", plusColor);

    // Horizontal line of the plus
    pattern
      .append("rect")
      .attr("x", plusSpacing / 2 - plusSize / 2)
      .attr("y", plusSpacing / 2 - plusThickness / 2)
      .attr("width", plusSize)
      .attr("height", plusThickness)
      .attr("fill", plusColor);

    // Color scheme by level
    const levelColors: Record<number, string> = {
      0: "#3b82f6", // Root - blue
      1: "#10b981", // Level 1 - green
      2: "#f59e0b", // Level 2 - orange
      3: "#ef4444", // Level 3 - red
    };

    // Add arrow markers for reciprocated vouches (level colors)
    Object.entries(levelColors).forEach(([level, color]) => {
      defs
        .append("marker")
        .attr("id", `arrow-reciprocal-${level}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 5)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color)
        .attr("opacity", 1);
    });

    // Add arrow marker for non-reciprocated vouches (red)
    defs
      .append("marker")
      .attr("id", "arrow-non-reciprocal")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 5)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#ef4444")
      .attr("opacity", 0.8);

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

    // Create a map to detect reciprocal vouches
    const vouchPairs = new Map<string, Set<string>>();
    allVouches.forEach((vouch) => {
      const sourceId = vouch.authorProfileId.toString();
      const targetId = vouch.subjectProfileId.toString();
      if (!vouchPairs.has(sourceId)) {
        vouchPairs.set(sourceId, new Set());
      }
      vouchPairs.get(sourceId)!.add(targetId);
    });

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
      
      // Determine link level based on the maximum level of the connected nodes
      // This ensures connections between first-ring nodes are colored green
      const linkLevel = Math.max(sourceNode.level, targetNode.level);
      
      // Check if this vouch is reciprocated
      const isReciprocal = vouchPairs.get(targetId)?.has(sourceId) ?? false;
    
      return [
        {
          source: sourceId,
          target: targetId,
          amount,
          level: linkLevel,
          isReciprocal,
        },
      ];
    });

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

    // Apply initial zoom out on small screens
    if (window.innerWidth < 768) {
      const initialScale = 0.6; // Zoom out to 60% on small screens
      // Center the zoomed-out view
      const tx = (width - width * initialScale) / (2 * initialScale);
      const ty = (height - height * initialScale) / (2 * initialScale);
      const initialTransform = d3.zoomIdentity.scale(initialScale).translate(tx, ty);
      svg.call(zoom.transform, initialTransform);
    }

    // Create force simulation with radial positioning for levels
    const simulation = d3
      .forceSimulation(nodes)
      .alphaDecay(0.08) // Slower convergence for better layout
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
            // Much larger distance between nodes for clarity
            return 250 + levelDiff * 150;
          })
      )
      .force("charge", d3.forceManyBody().strength((d) => {
        const node = d as Node;
        // Much stronger repulsion to push nodes apart
        return node.isRoot ? -1500 : -800 / (node.level + 1);
      }))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d) => {
          const node = d as Node;
          // Larger collision radius to prevent overlap
          return node.isRoot ? 90 : Math.max(60, 70 - node.level * 3);
        })
      )
      .force("radial", d3.forceRadial((d) => {
        const node = d as Node;
        // More spacing between concentric rings
        const baseRadius = 150;
        return baseRadius + node.level * 250;
      }, width / 2, height / 2).strength(0.8));

    // Create links with paths instead of lines for better arrow positioning
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("path")
      .data(links)
      .enter()
      .append("path")
      .attr("stroke", (d) => {
        // Red for non-reciprocated, level color for reciprocated
        return d.isReciprocal ? (levelColors[d.level] || "#64748b") : "#ef4444";
      })
      .attr("stroke-opacity", (d) => {
        // Reciprocal vouches are more opaque for emphasis
        return d.isReciprocal ? 0.7 : 0.5;
      })
      .attr("stroke-width", (d) => {
        const baseWidth = d.amount 
          ? Math.max(1, Math.min(5, Math.log10(d.amount + 1) * 1.5))
          : 2;
        const levelAdjustedWidth = Math.max(1, baseWidth - d.level * 0.3);
        // Reciprocal vouches are thicker
        return d.isReciprocal ? levelAdjustedWidth * 1.5 : levelAdjustedWidth;
      })
      .attr("fill", "none")
      .attr("marker-mid", (d) => {
        // Add arrow marker in the middle based on whether it's reciprocal
        return d.isReciprocal 
          ? `url(#arrow-reciprocal-${d.level})`
          : `url(#arrow-non-reciprocal)`;
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
      .style("cursor", "pointer")
      .on("click", function(event, d) {
        // Navigate to user's page using username or profileId
        const identifier = d.username || d.profileId?.toString() || d.id;
        router.push(`/${identifier}`);
      })
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
        if (d.isRoot) return 46;
        const radius = Math.max(18, 25 - d.level * 2);
        return 18 + radius;
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
        if (d.isRoot) return 58;
        const radius = Math.max(18, 25 - d.level * 2);
        return 29 + radius;
      })
      .attr("text-anchor", "middle")
      .attr("fill", getMutedColor())
      .attr("font-size", (d) => `${Math.max(8, 10 - d.level * 0.3)}px`)
      .text((d) => (d.score > 0 ? `Score: ${d.score}` : ""));

    // Update positions
    simulation.on("tick", () => {
      link.attr("d", (d) => {
        const source = d.source as Node;
        const target = d.target as Node;
        const sourceX = source.x ?? 0;
        const sourceY = source.y ?? 0;
        const targetX = target.x ?? 0;
        const targetY = target.y ?? 0;
        
        // Calculate angle and adjust for node radii
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const angle = Math.atan2(dy, dx);
        const sourceRadius = source.isRoot ? 35 : Math.max(18, 25 - source.level * 2);
        const targetRadius = target.isRoot ? 35 : Math.max(18, 25 - target.level * 2);
        
        // Calculate start and end points (adjusted for node circles)
        const x1 = sourceX + Math.cos(angle) * sourceRadius;
        const y1 = sourceY + Math.sin(angle) * sourceRadius;
        const x2 = targetX - Math.cos(angle) * targetRadius;
        const y2 = targetY - Math.sin(angle) * targetRadius;
        
        // Calculate midpoint
        let arrowX = (x1 + x2) / 2;
        let arrowY = (y1 + y2) / 2;
        
        // If reciprocal, offset arrow slightly towards target to create space between arrows
        if (d.isReciprocal) {
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length > 0) {
            const offset = 12; // Offset distance in pixels (matches review map)
            // Normalize direction vector and offset towards target
            arrowX += (dx / length) * offset;
            arrowY += (dy / length) * offset;
          }
        }
        
        // Create path with 3 points: start, arrow point, end (for marker-mid to work)
        return `M ${x1},${y1} L ${arrowX},${arrowY} L ${x2},${y2}`;
      });

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

  // Count vouches by level and reciprocal vouches
  const levelCounts = allVouches.reduce((acc, vouch) => {
    acc[vouch.level] = (acc[vouch.level] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  // Count reciprocal vouches
  const vouchPairs = new Map<string, Set<string>>();
  allVouches.forEach((vouch) => {
    const sourceId = vouch.authorProfileId.toString();
    const targetId = vouch.subjectProfileId.toString();
    if (!vouchPairs.has(sourceId)) {
      vouchPairs.set(sourceId, new Set());
    }
    vouchPairs.get(sourceId)!.add(targetId);
  });
  
  let reciprocalCount = 0;
  const countedPairs = new Set<string>();
  allVouches.forEach((vouch) => {
    const sourceId = vouch.authorProfileId.toString();
    const targetId = vouch.subjectProfileId.toString();
    const isReciprocal = vouchPairs.get(targetId)?.has(sourceId) ?? false;
    
    if (isReciprocal) {
      // Create a unique pair key (sorted to avoid counting both directions)
      const pairKey = [sourceId, targetId].sort().join("-");
      if (!countedPairs.has(pairKey)) {
        reciprocalCount++;
        countedPairs.add(pairKey);
      }
    }
  });

  const levelLabels: Record<number, string> = {
    1: "1st ring",
    2: "2nd ring",
    3: "3rd ring",
  };

  const resetView = () => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      let initialTransform = d3.zoomIdentity;
      
      // Apply zoom out on small screens
      if (window.innerWidth < 768) {
        const width = svgRef.current.clientWidth || 1000;
        const height = svgRef.current.clientHeight || 600;
        const initialScale = 0.6;
        const tx = (width - width * initialScale) / (2 * initialScale);
        const ty = (height - height * initialScale) / (2 * initialScale);
        initialTransform = d3.zoomIdentity.scale(initialScale).translate(tx, ty);
      }
      
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
          className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center p-2 md:p-4"
          onClick={toggleFullscreen}
        >
          <div 
            className="w-full h-full overflow-hidden rounded-lg border bg-background p-2 md:p-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between mb-1 md:mb-2 gap-2 md:gap-0">
              <div className="text-xs md:text-sm text-muted-foreground space-y-1.5 md:space-y-2 flex-1">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Showing {allVouches.length} vouch{allVouches.length !== 1 ? "es" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                    {allVouches.length >= MAX_TOTAL_NODES && (
                      <span className="text-xs ml-1 md:ml-2">(limited)</span>
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-green-600 dark:text-green-400" title="Reciprocal vouches (bidirectional trust)">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {reciprocalCount} reciprocal
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400" title="Non-reciprocated vouches (one-way trust)">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    {allVouches.length - (reciprocalCount * 2)} one-way
                  </span>
                </div>
                <div className="flex gap-2 md:gap-4 flex-wrap">
                  {Object.entries(levelCounts).map(([level, count]) => {
                    const levelNum = parseInt(level);
                    const isVisible = levelNum === 1 ? true : visibleRings[levelNum] ?? false;
                    const isClickable = levelNum !== 1;
                    
                    if (isClickable) {
                      return (
                        <button
                          key={level}
                          type="button"
                          className="inline-flex items-center gap-[3px] h-9 px-3 rounded-full border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                          onClick={() => toggleRing(levelNum)}
                          title={`Click to ${isVisible ? 'hide' : 'show'} ${levelLabels[levelNum] || `Level ${level}`}`}
                        >
                          <span 
                            className="inline-block w-[11px] h-[11px] rounded-full shrink-0" 
                            style={{ 
                              backgroundColor: level === "0" ? "#3b82f6" : 
                                              level === "1" ? "#10b981" : 
                                              level === "2" ? "#f59e0b" : "#ef4444",
                              opacity: isVisible ? 1 : 0.3
                            }}
                          />
                          <span className="text-sm" style={{ opacity: isVisible ? 1 : 0.5 }}>
                            {levelLabels[levelNum] || `Level ${level}`}: {count}
                          </span>
                        </button>
                      );
                    }
                    
                    return (
                      <span 
                        key={level} 
                        className="inline-flex items-center gap-[3px] h-9 px-3 rounded-full border border-border/50 bg-background opacity-75 cursor-not-allowed"
                      >
                        <span 
                          className="inline-block w-[11px] h-[11px] rounded-full shrink-0" 
                          style={{ 
                            backgroundColor: level === "0" ? "#3b82f6" : 
                                            level === "1" ? "#10b981" : 
                                            level === "2" ? "#f59e0b" : "#ef4444",
                            opacity: isVisible ? 1 : 0.3
                          }}
                        />
                        <span className="text-sm" style={{ opacity: isVisible ? 1 : 0.5 }}>
                          {levelLabels[levelNum] || `Level ${level}`}: {count}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-1 md:gap-2 md:ml-4 shrink-0">
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
        <div ref={containerRef} className="w-full overflow-auto rounded-lg border bg-background p-2 md:p-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between mb-1 md:mb-2 gap-2 md:gap-0">
            <div className="text-xs md:text-sm text-muted-foreground space-y-1.5 md:space-y-2 flex-1">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  Showing {allVouches.length} vouch{allVouches.length !== 1 ? "es" : ""} across {Object.keys(levelCounts).length} level{Object.keys(levelCounts).length !== 1 ? "s" : ""}
                  {allVouches.length >= MAX_TOTAL_NODES && (
                    <span className="text-xs ml-1 md:ml-2">(limited)</span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-green-600 dark:text-green-400" title="Reciprocal vouches (bidirectional trust)">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  {reciprocalCount} reciprocal
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400" title="Non-reciprocated vouches (one-way trust)">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  {allVouches.length - (reciprocalCount * 2)} one-way
                </span>
              </div>
              <div className="flex gap-2 md:gap-4 flex-wrap">
                {Object.entries(levelCounts).map(([level, count]) => {
                  const levelNum = parseInt(level);
                  const isVisible = levelNum === 1 ? true : visibleRings[levelNum] ?? false;
                  const isClickable = levelNum !== 1;
                  
                  if (isClickable) {
                    return (
                      <button
                        key={level}
                        type="button"
                        className="inline-flex items-center gap-[3px] h-9 px-3 rounded-full border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                        onClick={() => toggleRing(levelNum)}
                        title={`Click to ${isVisible ? 'hide' : 'show'} ${levelLabels[levelNum] || `Level ${level}`}`}
                      >
                        <span 
                          className="inline-block w-[11px] h-[11px] rounded-full shrink-0" 
                          style={{ 
                            backgroundColor: level === "0" ? "#3b82f6" : 
                                            level === "1" ? "#10b981" : 
                                            level === "2" ? "#f59e0b" : "#ef4444",
                            opacity: isVisible ? 1 : 0.3
                          }}
                        />
                        <span className="text-sm" style={{ opacity: isVisible ? 1 : 0.5 }}>
                          {levelLabels[levelNum] || `Level ${level}`}: {count}
                        </span>
                      </button>
                    );
                  }
                  
                  return (
                    <span 
                      key={level} 
                      className="inline-flex items-center gap-[3px] h-9 px-3 rounded-full border border-border/50 bg-background opacity-75 cursor-not-allowed"
                    >
                      <span 
                        className="inline-block w-3 h-3 rounded-full shrink-0" 
                        style={{ 
                          backgroundColor: level === "0" ? "#3b82f6" : 
                                          level === "1" ? "#10b981" : 
                                          level === "2" ? "#f59e0b" : "#ef4444",
                          opacity: isVisible ? 1 : 0.3
                        }}
                      />
                      <span className="text-sm" style={{ opacity: isVisible ? 1 : 0.5 }}>
                        {levelLabels[levelNum] || `Level ${level}`}: {count}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-1 md:gap-2 md:ml-4 shrink-0">
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
          <div className="w-full aspect-square md:aspect-auto md:h-[600px]">
            <svg ref={svgRef} className="w-full h-full" style={{ shapeRendering: "geometricPrecision" }}></svg>
          </div>
        </div>
      )}
    </>
  );
}

