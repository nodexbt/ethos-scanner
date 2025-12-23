"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, LineData, Time, LineSeries } from "lightweight-charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getCachedData, setCachedData, CacheDurations } from "@/lib/cache";
import { useTheme } from "@/components/theme-provider";

interface XPChartProps {
  userId: number;
  profileId: number | null;
  currentXP: number;
}

interface XPHistoryPoint {
  time: number; // Unix timestamp
  value: number; // XP value at that time (cumulative)
  weeklyXp?: number; // Weekly XP gained
}

function getXPHistoryCacheKey(profileId: number, seasonId: number): string {
  return `ethos-xp-history-${profileId}-season-${seasonId}`;
}

export function XPChart({ userId, profileId, currentXP }: XPChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<XPHistoryPoint[]>([]); // Store full data for tooltip
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [availableSeasons, setAvailableSeasons] = useState<Array<{ id: number; name: string }>>([]);
  const [seasonXP, setSeasonXP] = useState<Map<number, number>>(new Map()); // Map season ID to XP gained

  useEffect(() => {
    setMounted(true);
    return () => {
      if (resizeCleanupRef.current) {
        resizeCleanupRef.current();
        resizeCleanupRef.current = null;
      }
      if (tooltipRef.current && tooltipRef.current.parentNode) {
        tooltipRef.current.parentNode.removeChild(tooltipRef.current);
        tooltipRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, []);

  // Fetch available seasons on mount
  useEffect(() => {
    if (!mounted || !profileId) {
      if (!profileId) {
        setLoading(false);
      }
      return;
    }

    const fetchSeasons = async () => {
      setLoading(true); // Start loading while fetching seasons
      try {
        console.log("XP Chart - Fetching seasons...");
        const seasonsResponse = await fetch(
          "https://api.ethos.network/api/v2/xp/seasons",
          {
            method: "GET",
            headers: {
              "X-Ethos-Client": "ethos-scanner",
              "Accept": "application/json",
            },
          }
        );

        console.log("XP Chart - Seasons response status:", seasonsResponse.status);

        if (seasonsResponse.ok) {
          const seasonsData = await seasonsResponse.json();
          console.log("XP Chart - Seasons data:", seasonsData);
          const seasons = seasonsData.seasons || [];
          setAvailableSeasons(seasons);
          
          // Set default to current season, or season 0 if available
          if (seasonsData.currentSeason) {
            console.log("XP Chart - Setting current season:", seasonsData.currentSeason.id);
            setSelectedSeason(seasonsData.currentSeason.id);
          } else if (seasons.length > 0) {
            console.log("XP Chart - Setting first season:", seasons[0].id);
            setSelectedSeason(seasons[0].id);
          } else {
            // Fallback to season 0
            console.log("XP Chart - No seasons found, using fallback");
            setAvailableSeasons([
              { id: 0, name: "Season 0" },
              { id: 1, name: "Season 1" },
            ]);
            setSelectedSeason(0);
          }
        } else {
          const errorText = await seasonsResponse.text();
          console.error("XP Chart - Seasons error response:", errorText);
          // Fallback: allow manual selection of season 0 and 1
          setAvailableSeasons([
            { id: 0, name: "Season 0" },
            { id: 1, name: "Season 1" },
          ]);
          setSelectedSeason(0);
        }
      } catch (err) {
        console.error("XP Chart - Failed to fetch seasons:", err);
        // Fallback: allow manual selection of season 0 and 1
        setAvailableSeasons([
          { id: 0, name: "Season 0" },
          { id: 1, name: "Season 1" },
        ]);
        setSelectedSeason(0);
      }
    };

    fetchSeasons();
  }, [mounted, profileId]);

  // Fetch XP history when season changes
  useEffect(() => {
    if (!mounted || !profileId) {
      if (!profileId) {
        setLoading(false);
        setError("Profile ID not available");
      }
      return;
    }

    // Wait for season to be selected (including season 0)
    if (selectedSeason === null || selectedSeason === undefined) {
      // Season not selected yet, keep loading while we wait
      return;
    }

    const fetchXPHistory = async (seasonId: number) => {
      // Season 0 is valid, so we check for null/undefined specifically
      if (seasonId === null || seasonId === undefined) {
        setError("No season selected");
        setLoading(false);
        return;
      }

      // Try cache first
      const cacheKey = getXPHistoryCacheKey(profileId, seasonId);
      const cachedHistory = getCachedData<XPHistoryPoint[]>(
        cacheKey,
        CacheDurations.PROFILE
      );

      if (cachedHistory && cachedHistory.length > 0) {
        // Wait for container to be available - it should always be rendered
        const tryRender = (attempts = 0) => {
          if (chartContainerRef.current) {
            renderChart(cachedHistory);
            setLoading(false);
          } else if (attempts < 10) {
            // Retry up to 10 times (1 second total)
            setTimeout(() => tryRender(attempts + 1), 100);
          } else {
            console.error("Chart container not available after multiple retries");
            setError("Chart container not available");
            setLoading(false);
          }
        };
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => tryRender());
        return;
      }

      // No cached data, proceed to fetch from API

      // Fetch from API
      setLoading(true);
      setError(null);

      try {
        let xpHistory: XPHistoryPoint[] | null = null;
        // Userkey format per https://developers.ethos.network/#userkeys
        // Format: profileId:<id> (e.g., "profileId:10")
        const userkey = `profileId:${profileId}`;

        console.log("Fetching XP history for:", { userId, profileId, currentXP, userkey, seasonId });

        // Step 1: Get week date ranges for the selected season
        console.log("XP Chart - Fetching weeks for season:", seasonId);
        const weeksResponse = await fetch(
          `https://api.ethos.network/api/v2/xp/season/${seasonId}/weeks`,
          {
            method: "GET",
            headers: {
              "X-Ethos-Client": "ethos-scanner",
              "Accept": "application/json",
            },
          }
        );

        console.log("XP Chart - Weeks response status:", weeksResponse.status);
        
        const weekDateMap: Map<number, { startDate: string; endDate: string }> = new Map();
        let seasonStartDate: string | null = null;
        
        if (weeksResponse.ok) {
          const weeksData = await weeksResponse.json();
          console.log("XP Chart - Weeks data:", weeksData);
          weeksData.forEach((week: { week: number; startDate: string; endDate: string }) => {
            weekDateMap.set(week.week, {
              startDate: week.startDate,
              endDate: week.endDate,
            });
            if (!seasonStartDate) {
              seasonStartDate = week.startDate;
            }
          });
        } else {
          const errorText = await weeksResponse.text();
          console.error("XP Chart - Weeks error response:", errorText);
        }

        // Step 2: Get weekly XP data for the selected season
        // Userkey format: "profileId:123" per https://developers.ethos.network/#userkeys
        // Need to encode the colon (%3A) for URL path usage
        // Endpoint: /xp/user/{userkey}/season/{seasonId}/weekly
        // This works for season 0, season 1, and any other season IDs
        const encodedUserkey = encodeURIComponent(userkey);
        const weeklyXPUrl = `https://api.ethos.network/api/v2/xp/user/${encodedUserkey}/season/${seasonId}/weekly`;
        console.log("XP Chart - Fetching weekly XP from:", weeklyXPUrl);
        console.log("XP Chart - userkey:", userkey, "encoded:", encodedUserkey, "seasonId:", seasonId, "(type:", typeof seasonId, ")");
        
        const weeklyXPResponse = await fetch(weeklyXPUrl, {
          method: "GET",
          headers: {
            "X-Ethos-Client": "ethos-scanner",
            "Accept": "application/json",
          },
        });

        console.log("XP Chart - Weekly XP response status:", weeklyXPResponse.status);
        
        if (!weeklyXPResponse.ok) {
          const errorText = await weeklyXPResponse.text();
          console.error("XP Chart - Weekly XP error response:", errorText);
        }

        if (weeklyXPResponse.ok) {
          const weeklyData = await weeklyXPResponse.json();
          console.log("Weekly XP data:", weeklyData);
          console.log("Weekly XP data length:", weeklyData?.length);
          
          if (Array.isArray(weeklyData) && weeklyData.length > 0) {
            // Calculate total XP gained in this season (sum of all weekly XP)
            const totalSeasonXP = weeklyData.reduce((sum, week: { weeklyXp: number }) => {
              return sum + (week.weeklyXp || 0);
            }, 0);
            
            // Update season XP map
            setSeasonXP((prev) => {
              const newMap = new Map(prev);
              newMap.set(seasonId, totalSeasonXP);
              return newMap;
            });

            // Convert weekly data to chart points - include ALL weeks
            xpHistory = weeklyData
              .sort((a: { week: number }, b: { week: number }) => a.week - b.week) // Sort by week number first
              .map((week: { week: number; weeklyXp: number; cumulativeXp: number }) => {
                // Use endDate of the week as the timestamp, or calculate from week number
                let timestamp: number;
                
                if (weekDateMap.has(week.week)) {
                  const weekInfo = weekDateMap.get(week.week)!;
                  // Parse the endDate (assuming ISO format)
                  timestamp = Math.floor(new Date(weekInfo.endDate).getTime() / 1000);
                } else {
                  // Fallback: estimate timestamp from season start + weeks
                  // Week numbers start at 0, so week 0 = season start, week 1 = season start + 7 days, etc.
                  const seasonStart = seasonStartDate ? new Date(seasonStartDate) : new Date();
                  const weekEnd = new Date(seasonStart);
                  weekEnd.setDate(weekEnd.getDate() + (week.week + 1) * 7 - 1); // End of the week
                  timestamp = Math.floor(weekEnd.getTime() / 1000);
                }

                return {
                  time: timestamp,
                  value: week.cumulativeXp || 0, // Use cumulativeXp from API response
                  weeklyXp: week.weeklyXp || 0, // Store weekly XP for tooltip
                };
              });

            console.log("Mapped XP history points:", xpHistory.length);
            // Don't add current XP point - the API data is authoritative
            // The last week's cumulativeXp should match or be close to currentXP
          } else {
            console.log("Weekly XP data is empty, using fallback");
          }
        } else if (weeklyXPResponse.status === 404) {
          console.log("No weekly XP data found for user");
          setError("No weekly XP data available for this season");
          setLoading(false);
          return;
        } else {
          console.warn(`Failed to fetch weekly XP: ${weeklyXPResponse.status}`);
          setError(`Failed to fetch weekly XP data: ${weeklyXPResponse.status}`);
          setLoading(false);
          return;
        }

        // If no XP history data was fetched, show error
        if (!xpHistory || xpHistory.length === 0) {
          setError("No weekly XP data available for this season");
          setLoading(false);
          return;
        }

        if (xpHistory && xpHistory.length > 0) {
          // Ensure data is sorted by time
          xpHistory.sort((a, b) => a.time - b.time);
          
          // Validate data points - be less strict to include all valid data
          const validHistory = xpHistory.filter(
            (point) => {
              const isValidTime = point.time > 0 && !isNaN(point.time);
              const isValidValue = !isNaN(point.value) && point.value >= 0;
              if (!isValidTime || !isValidValue) {
                console.warn("Filtered out invalid point:", point);
              }
              return isValidTime && isValidValue;
            }
          );

          console.log("Valid XP history points:", validHistory.length, "out of", xpHistory.length);
          console.log("First few points:", validHistory.slice(0, 5));
          console.log("Last few points:", validHistory.slice(-5));

          if (validHistory.length > 0) {
            // Cache the results
            setCachedData(cacheKey, validHistory);
            
            // Wait for container to be available - it should always be rendered
            const tryRender = (attempts = 0) => {
              if (chartContainerRef.current) {
                console.log("Rendering chart with", validHistory.length, "data points");
                renderChart(validHistory);
                setLoading(false);
              } else if (attempts < 10) {
                // Retry up to 10 times (1 second total)
                console.warn(`Chart container not ready, retrying (attempt ${attempts + 1}/10)`);
                setTimeout(() => tryRender(attempts + 1), 100);
              } else {
                console.error("Chart container not available after multiple retries");
                setError("Chart container not available");
                setLoading(false);
              }
            };
            
            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => tryRender());
          } else {
            console.error("No valid data points after filtering");
            setError("Invalid XP history data - no valid points");
            setLoading(false);
          }
        } else {
          console.error("No XP history data generated");
          setError("No XP history data available");
          setLoading(false);
        }
      } catch (err) {
        console.error("Error fetching XP history:", err);
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch XP history";
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    const renderChart = (data: XPHistoryPoint[]) => {
      if (!chartContainerRef.current) {
        console.warn("Chart container not available, retrying...");
        // Retry after a short delay - container should be available since it's always rendered
        setTimeout(() => {
          if (chartContainerRef.current) {
            renderChart(data);
          } else {
            console.error("Chart container still not available after retry");
            setError("Chart container not available");
            setLoading(false);
          }
        }, 100);
        return;
      }

      if (!data || data.length === 0) {
        console.error("No data to render");
        setError("No data available to display");
        return;
      }

      try {
        // Remove existing chart if any
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
          seriesRef.current = null;
        }

        // Clean up previous resize listener
        if (resizeCleanupRef.current) {
          resizeCleanupRef.current();
          resizeCleanupRef.current = null;
        }

        // Ensure container has width
        const containerWidth = chartContainerRef.current.clientWidth || 800;
        
        // Get computed styles for theme colors
        const root = document.documentElement;
        const isDark = root.classList.contains("dark");
        const primaryColor = isDark ? "#fafafa" : "#0a0a0a"; // Use explicit colors for visibility
        const foregroundColor = isDark ? "#fafafa" : "#0a0a0a";
        const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
        const backgroundColor = isDark ? "#0a0a0a" : "#ffffff";
        
        // Create chart
        const chart = createChart(chartContainerRef.current, {
          width: containerWidth,
          height: 400,
          layout: {
            background: { color: backgroundColor },
            textColor: foregroundColor,
          },
          grid: {
            vertLines: { 
              color: borderColor,
              visible: true,
            },
            horzLines: { 
              color: borderColor,
              visible: true,
            },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: borderColor,
          },
          rightPriceScale: {
            borderColor: borderColor,
            textColor: foregroundColor,
          },
        });

        chartRef.current = chart;

        // Add line series with visible color and point markers
        // In lightweight-charts v5, use addSeries with LineSeries and options
        const lineSeries = chart.addSeries(LineSeries, {
          color: primaryColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          pointMarkersVisible: true,
          pointMarkersRadius: 4,
          priceFormat: {
            type: "price",
            precision: 0,
            minMove: 1,
          },
        });

        seriesRef.current = lineSeries;

        // Store full data for tooltip access
        dataRef.current = data;

        // Convert Unix timestamps to TradingView time format
        // TradingView expects Unix timestamps in seconds
        const chartData: LineData<Time>[] = data
          .map((point) => {
            // Ensure timestamp is in seconds (not milliseconds)
            let timestamp = point.time;
            if (timestamp > 10000000000) {
              // If timestamp is in milliseconds, convert to seconds
              timestamp = Math.floor(timestamp / 1000);
            }
            return {
              time: timestamp as Time,
              value: point.value,
            };
          })
          .filter((point) => {
            const timeValue = typeof point.time === 'number' ? point.time : Number(point.time);
            return timeValue > 0 && !isNaN(point.value);
          });

        if (chartData.length === 0) {
          throw new Error("No valid data points after conversion");
        }

        lineSeries.setData(chartData);
        
        // Fit the chart to show all data points across the full width
        chart.timeScale().fitContent();
        
        // Create tooltip element if it doesn't exist
        if (!tooltipRef.current && chartContainerRef.current) {
          const tooltip = document.createElement('div');
          tooltip.className = 'absolute pointer-events-none z-50 bg-popover border border-border rounded-md px-3 py-2 text-sm font-medium shadow-lg';
          tooltip.style.display = 'none';
          tooltip.style.position = 'absolute';
          tooltip.style.color = 'hsl(var(--popover-foreground))';
          chartContainerRef.current.style.position = 'relative';
          chartContainerRef.current.appendChild(tooltip);
          tooltipRef.current = tooltip;
          console.log("XP Chart - Tooltip element created");
        }

        // Subscribe to crosshair move to show weekly XP tooltip
        chart.subscribeCrosshairMove((param) => {
          if (!tooltipRef.current || !chartContainerRef.current || !dataRef.current || dataRef.current.length === 0) {
            if (tooltipRef.current) {
              tooltipRef.current.style.display = 'none';
            }
            return;
          }

          // Check if we have valid crosshair data
          if (param.point === undefined || !param.time) {
            if (tooltipRef.current) {
              tooltipRef.current.style.display = 'none';
            }
            return;
          }

          // Find the closest data point
          const time = param.time as number;
          const closestPoint = dataRef.current.reduce((closest, point) => {
            const pointTime = point.time > 10000000000 ? Math.floor(point.time / 1000) : point.time;
            const closestTime = closest.time > 10000000000 ? Math.floor(closest.time / 1000) : closest.time;
            return Math.abs(pointTime - time) < Math.abs(closestTime - time) ? point : closest;
          });

          if (closestPoint && closestPoint.weeklyXp !== undefined && closestPoint.weeklyXp > 0 && tooltipRef.current) {
            const tooltip = tooltipRef.current;
            tooltip.textContent = `+${closestPoint.weeklyXp.toLocaleString()} XP`;
            tooltip.style.display = 'block';
            
            // Position tooltip - param.point is relative to the chart pane
            // We need to get the chart container's position relative to the viewport
            const containerRect = chartContainerRef.current.getBoundingClientRect();
            const chartRect = chartContainerRef.current.querySelector('canvas')?.getBoundingClientRect();
            
            if (chartRect) {
              // Calculate position relative to container
              const tooltipWidth = 120;
              let left = param.point.x + 15;
              let top = param.point.y - 35;
              
              // Adjust if tooltip would go off screen
              if (left + tooltipWidth > containerRect.width) {
                left = param.point.x - tooltipWidth - 15;
              }
              if (top < 0) {
                top = param.point.y + 15;
              }
              
              tooltip.style.left = `${left}px`;
              tooltip.style.top = `${top}px`;
            } else {
              // Fallback positioning
              tooltip.style.left = `${param.point.x + 15}px`;
              tooltip.style.top = `${param.point.y - 35}px`;
            }
          } else if (tooltipRef.current) {
            tooltipRef.current.style.display = 'none';
          }
        });
        
        setError(null);
      } catch (err) {
        console.error("Error rendering chart:", err);
        setError(err instanceof Error ? err.message : "Failed to render chart");
      }

      // Handle resize
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener("resize", handleResize);
      
      // Store cleanup function
      resizeCleanupRef.current = () => {
        window.removeEventListener("resize", handleResize);
      };
    };

    fetchXPHistory(selectedSeason);
  }, [mounted, profileId, selectedSeason, userId, currentXP]);

  // Update chart colors when theme changes
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;

    const isDark = theme === "dark";
    const primaryColor = isDark ? "#fafafa" : "#0a0a0a";
    const foregroundColor = isDark ? "#fafafa" : "#0a0a0a";
    const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
    const backgroundColor = isDark ? "#0a0a0a" : "#ffffff";

    // Update chart options
    chartRef.current.applyOptions({
      layout: {
        background: { color: backgroundColor },
        textColor: foregroundColor,
      },
      grid: {
        vertLines: { 
          color: borderColor,
          visible: true,
        },
        horzLines: { 
          color: borderColor,
          visible: true,
        },
      },
      timeScale: {
        borderColor: borderColor,
      },
      rightPriceScale: {
        borderColor: borderColor,
        textColor: foregroundColor,
      },
    });

    // Update series color
    seriesRef.current.applyOptions({
      color: primaryColor,
    });
  }, [theme]);

  if (!profileId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>User XP</CardTitle>
            <CardDescription>Historical XP earned over time</CardDescription>
            <div className="mt-2">
              <div className="text-sm font-medium text-muted-foreground">Total XP</div>
              <div className="text-2xl font-semibold">{currentXP.toLocaleString()}</div>
            </div>
          </div>
          {availableSeasons.length > 0 && (
            <div className="flex flex-col gap-2 items-end">
              <div className="flex gap-2">
                {availableSeasons.map((season) => (
                  <Button
                    key={season.id}
                    variant={selectedSeason === season.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSeason(season.id)}
                    disabled={loading}
                  >
                    {season.name}
                  </Button>
                ))}
              </div>
              {selectedSeason !== null && seasonXP.has(selectedSeason) && (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">XP Gained This Season</div>
                  <div className="text-sm font-semibold">
                    +{seasonXP.get(selectedSeason)?.toLocaleString() || 0}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative" style={{ height: "400px" }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            </div>
          )}
          {/* Always render container so ref is available, hide when loading/error */}
          <div 
            ref={chartContainerRef} 
            className="w-full h-full" 
            style={{ display: loading || error ? "none" : "block" }} 
          />
        </div>
      </CardContent>
    </Card>
  );
}

