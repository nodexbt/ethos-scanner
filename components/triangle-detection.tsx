"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { TriangleList } from "@/components/triangle-list";
import {
  getCachedData,
  setCachedData,
  getReviewsCacheKey,
  CacheDurations,
} from "@/lib/cache";

// --- Types ---

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

interface DetectedNode {
  id: string;
  profileId: number;
  name: string;
  username: string | null;
  score: number;
}

interface DetectedTriangle {
  nodes: [DetectedNode, DetectedNode, DetectedNode];
  suspicionScore: number;
  timeSpanHours: number | null;
  suspiciousReasons: string[];
}

interface TriangleDetectionProps {
  profileId: number;
  userName: string;
}

// --- Constants ---

const MAX_FETCH_LIMIT = 50;
const LOW_SCORE_THRESHOLD = 1000;

// --- Component ---

export function TriangleDetection({
  profileId,
  userName,
}: TriangleDetectionProps) {
  const [triangles, setTriangles] = useState<DetectedTriangle[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    nodesScanned: number;
    edgesFound: number;
    trianglesFound: number;
  } | null>(null);

  useEffect(() => {
    detectTriangles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const detectTriangles = async () => {
    setLoading(true);
    setError(null);
    setProgress("Fetching reviews...");

    try {
      const userkey = `profileId:${profileId}`;

      // Step 1: Fetch level 1 reviews (given + received)
      const givenCacheKey = getReviewsCacheKey(profileId, "given");
      const receivedCacheKey = getReviewsCacheKey(profileId, "received");

      let givenData: ReviewsResponse;
      let receivedData: ReviewsResponse;

      const cachedGiven = getCachedData<ReviewsResponse>(
        givenCacheKey,
        CacheDurations.REVIEWS
      );
      const cachedReceived = getCachedData<ReviewsResponse>(
        receivedCacheKey,
        CacheDurations.REVIEWS
      );

      if (cachedGiven && cachedReceived) {
        givenData = cachedGiven;
        receivedData = cachedReceived;
      } else {
        const [givenRes, receivedRes] = await Promise.all([
          fetch(
            "https://api.ethos.network/api/v2/activities/profile/given",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Ethos-Client": "ethos-scanner@0.1.0",
              },
              body: JSON.stringify({
                userkey,
                filter: ["review"],
                limit: MAX_FETCH_LIMIT,
              }),
            }
          ),
          fetch(
            "https://api.ethos.network/api/v2/activities/profile/received",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Ethos-Client": "ethos-scanner@0.1.0",
              },
              body: JSON.stringify({
                userkey,
                filter: ["review"],
                limit: MAX_FETCH_LIMIT,
              }),
            }
          ),
        ]);

        if (!givenRes.ok || !receivedRes.ok) {
          setError("Failed to fetch reviews");
          setLoading(false);
          return;
        }

        givenData = await givenRes.json();
        receivedData = await receivedRes.json();
        setCachedData(givenCacheKey, givenData);
        setCachedData(receivedCacheKey, receivedData);
      }

      // Step 2: Build node map from level 1 reviews
      const nodeMap = new Map<string, DetectedNode>();
      const rootId = `profile-${profileId}`;

      // Collect all level 1 profile IDs
      const level1ProfileIds = new Set<number>();

      const allLevel1Reviews = [
        ...(givenData.values || []),
        ...(receivedData.values || []),
      ];

      allLevel1Reviews.forEach((r) => {
        const authorId = `profile-${r.author.profileId}`;
        const subjectId = `profile-${r.subject.profileId}`;

        if (!nodeMap.has(authorId)) {
          nodeMap.set(authorId, {
            id: authorId,
            profileId: r.author.profileId,
            name: r.author.name,
            username: r.author.username,
            score: 0,
          });
        }
        if (!nodeMap.has(subjectId)) {
          nodeMap.set(subjectId, {
            id: subjectId,
            profileId: r.subject.profileId,
            name: r.subject.name,
            username: r.subject.username,
            score: 0,
          });
        }

        if (r.author.profileId !== profileId)
          level1ProfileIds.add(r.author.profileId);
        if (r.subject.profileId !== profileId)
          level1ProfileIds.add(r.subject.profileId);
      });

      // Step 3: Fetch inter-connections between level 1 nodes
      setProgress(
        `Scanning connections between ${level1ProfileIds.size} profiles...`
      );

      const level1Array = Array.from(level1ProfileIds);
      const interResults = await Promise.all(
        level1Array.map(async (pid) => {
          try {
            const res = await fetch(
              "https://api.ethos.network/api/v2/activities/profile/given",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Ethos-Client": "ethos-scanner@0.1.0",
                },
                body: JSON.stringify({
                  userkey: `profileId:${pid}`,
                  filter: ["review"],
                  limit: 100,
                }),
              }
            );
            if (!res.ok) return [];
            const data: ReviewsResponse = await res.json();
            // Only include reviews to other level 1 nodes or root
            return (data.values || []).filter(
              (a) =>
                level1ProfileIds.has(a.subject.profileId) ||
                a.subject.profileId === profileId
            );
          } catch {
            return [];
          }
        })
      );

      const interReviews = interResults.flat();

      // Combine all reviews
      const allReviews = [...allLevel1Reviews, ...interReviews];

      // Step 4: Build directed graph (positive edges only)
      setProgress("Detecting triangle patterns...");

      const positiveEdges = new Map<string, Set<string>>();
      const positiveEdgeSet = new Set<string>();
      const edgeTimestamps = new Map<string, number>();
      const givenCounts = new Map<string, number>();
      const receivedCounts = new Map<string, number>();

      allReviews.forEach((r) => {
        const sourceId = `profile-${r.author.profileId}`;
        const targetId = `profile-${r.subject.profileId}`;
        if (sourceId === targetId) return; // skip self-reviews

        const edgeKey = `${sourceId}->${targetId}`;
        if (r.data.createdAt) {
          edgeTimestamps.set(edgeKey, r.data.createdAt);
        }

        // Also add nodes from inter-reviews
        if (!nodeMap.has(sourceId)) {
          nodeMap.set(sourceId, {
            id: sourceId,
            profileId: r.author.profileId,
            name: r.author.name,
            username: r.author.username,
            score: 0,
          });
        }
        if (!nodeMap.has(targetId)) {
          nodeMap.set(targetId, {
            id: targetId,
            profileId: r.subject.profileId,
            name: r.subject.name,
            username: r.subject.username,
            score: 0,
          });
        }

        if (r.data.score === "positive") {
          positiveEdgeSet.add(edgeKey);
          if (!positiveEdges.has(sourceId)) {
            positiveEdges.set(sourceId, new Set());
          }
          positiveEdges.get(sourceId)!.add(targetId);

          givenCounts.set(sourceId, (givenCounts.get(sourceId) || 0) + 1);
          receivedCounts.set(
            targetId,
            (receivedCounts.get(targetId) || 0) + 1
          );
        }
      });

      // Step 5: Find A→B→C→A triangles involving the root profile
      const foundTriangles: DetectedTriangle[] = [];
      const seenTriangles = new Set<string>();

      for (const [nodeAId, neighborsA] of positiveEdges) {
        for (const nodeBId of neighborsA) {
          const neighborsB = positiveEdges.get(nodeBId);
          if (!neighborsB) continue;

          for (const nodeCId of neighborsB) {
            if (nodeCId === nodeAId) continue; // skip 2-cycles
            const neighborsC = positiveEdges.get(nodeCId);
            if (!neighborsC || !neighborsC.has(nodeAId)) continue;

            // Check no positive reciprocation on any edge
            const abReciprocated = positiveEdgeSet.has(
              `${nodeBId}->${nodeAId}`
            );
            const bcReciprocated = positiveEdgeSet.has(
              `${nodeCId}->${nodeBId}`
            );
            const caReciprocated = positiveEdgeSet.has(
              `${nodeAId}->${nodeCId}`
            );

            if (abReciprocated || bcReciprocated || caReciprocated) continue;

            // Only include triangles involving the root profile
            if (
              nodeAId !== rootId &&
              nodeBId !== rootId &&
              nodeCId !== rootId
            )
              continue;

            // Deduplicate by sorted IDs
            const sortedIds = [nodeAId, nodeBId, nodeCId].sort();
            const triKey = sortedIds.join("|");
            if (seenTriangles.has(triKey)) continue;
            seenTriangles.add(triKey);

            const nodeA = nodeMap.get(nodeAId);
            const nodeB = nodeMap.get(nodeBId);
            const nodeC = nodeMap.get(nodeCId);
            if (!nodeA || !nodeB || !nodeC) continue;

            // Time span
            const timestamps = [
              edgeTimestamps.get(`${nodeAId}->${nodeBId}`),
              edgeTimestamps.get(`${nodeBId}->${nodeCId}`),
              edgeTimestamps.get(`${nodeCId}->${nodeAId}`),
            ].filter((t): t is number => t != null);

            let timeSpanHours: number | null = null;
            if (timestamps.length === 3) {
              const minT = Math.min(...timestamps);
              const maxT = Math.max(...timestamps);
              timeSpanHours =
                Math.round(((maxT - minT) / (1000 * 60 * 60)) * 10) / 10;
            }

            // Suspicion analysis
            const reasons: string[] = [];
            let suspicionScore = 0;

            [nodeA, nodeB, nodeC].forEach((n) => {
              const given = givenCounts.get(n.id) || 0;
              const received = receivedCounts.get(n.id) || 0;
              const isGiveOnly = given >= 2 && received <= 1;
              const hasHighRatio =
                given >= 2 && given / Math.max(received, 1) >= 3;

              if (isGiveOnly) {
                reasons.push(`${n.name}: give-only pattern`);
                suspicionScore++;
              } else if (hasHighRatio) {
                reasons.push(
                  `${n.name}: high give ratio (${Math.round((given / Math.max(received, 1)) * 10) / 10}:1)`
                );
                suspicionScore++;
              }
              if (n.score > 0 && n.score < LOW_SCORE_THRESHOLD) {
                reasons.push(`${n.name}: low score (${n.score})`);
                suspicionScore++;
              }
            });

            if (timeSpanHours != null && timeSpanHours <= 48) {
              suspicionScore += 2;
              reasons.push(
                `All reviews within ${timeSpanHours.toFixed(1)} hours`
              );
            } else if (timeSpanHours != null && timeSpanHours <= 168) {
              suspicionScore += 1;
              reasons.push(
                `All reviews within ${(timeSpanHours / 24).toFixed(1)} days`
              );
            }

            foundTriangles.push({
              nodes: [nodeA, nodeB, nodeC],
              suspicionScore,
              timeSpanHours,
              suspiciousReasons: reasons,
            });
          }
        }
      }

      // Sort by suspicion score
      foundTriangles.sort((a, b) => b.suspicionScore - a.suspicionScore);

      setTriangles(foundTriangles);
      setStats({
        nodesScanned: nodeMap.size,
        edgesFound: positiveEdgeSet.size,
        trianglesFound: foundTriangles.length,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to detect triangles"
      );
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{progress}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Profiles Scanned</div>
            <div className="text-2xl font-semibold">{stats.nodesScanned}</div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              Positive Review Edges
            </div>
            <div className="text-2xl font-semibold">{stats.edgesFound}</div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              Triangles Detected
            </div>
            <div className="text-2xl font-semibold flex items-center gap-2">
              {stats.trianglesFound}
              {stats.trianglesFound > 0 && (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detection criteria */}
      <div className="rounded-md border border-border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
        <div className="font-medium text-foreground text-sm mb-2">
          Detection Criteria
        </div>
        <div>
          Directed cycle A→B→C→A where all edges are positive reviews
        </div>
        <div>
          No positive reciprocation on any edge (B→A, C→B, or A→C)
        </div>
        <div>
          Suspicion score based on: give-only patterns, low credibility scores,
          time proximity of reviews
        </div>
      </div>

      {/* Triangle list */}
      {triangles.length === 0 ? (
        <div className="rounded-md bg-muted p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No triangle patterns detected in the review network
          </p>
        </div>
      ) : (
        <TriangleList
          triangles={triangles}
          rootName={userName}
        />
      )}
    </div>
  );
}
