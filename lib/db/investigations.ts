import { getSupabase } from "./supabase";
import { nanoid } from "../utils";

export interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  targetAvatar: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
  hasAnalysis: boolean;
  shareId: string | null;
  isPublic: boolean;
}

export interface InvestigationRow {
  id: string;
  target: string;
  targetName: string | null;
  clusterResult: unknown;
  aiAnalysis: string | null;
  shareId: string | null;
  isPublic: boolean;
}

export async function listInvestigations(): Promise<InvestigationSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("id, target, target_name, target_avatar, cluster_result, ai_analysis, share_id, is_public, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listInvestigations error:", error);
    return [];
  }

  return (data || []).map((row) => {
    let strongCount = 0;
    let possibleCount = 0;
    let targetAvatar: string | null = null;
    try {
      const result = typeof row.cluster_result === "string"
        ? JSON.parse(row.cluster_result)
        : row.cluster_result;
      strongCount = result?.strongCluster?.length ?? 0;
      possibleCount = result?.possibleCluster?.length ?? 0;
      targetAvatar = result?.targetEthos?.avatarUrl ?? row.target_avatar ?? null;
    } catch {}

    return {
      id: row.id,
      target: row.target,
      targetName: row.target_name,
      targetAvatar,
      savedAt: new Date(row.updated_at).getTime(),
      strongCount,
      possibleCount,
      hasAnalysis: !!row.ai_analysis,
      shareId: row.share_id,
      isPublic: row.is_public ?? false,
    };
  });
}

export async function getInvestigation(id: string): Promise<InvestigationRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    target: data.target,
    targetName: data.target_name,
    clusterResult: typeof data.cluster_result === "string"
      ? JSON.parse(data.cluster_result)
      : data.cluster_result,
    aiAnalysis: data.ai_analysis,
    shareId: data.share_id,
    isPublic: data.is_public ?? false,
  };
}

export async function getInvestigationByShareId(shareId: string): Promise<InvestigationRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("*")
    .eq("share_id", shareId)
    .eq("is_public", true)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    target: data.target,
    targetName: data.target_name,
    clusterResult: typeof data.cluster_result === "string"
      ? JSON.parse(data.cluster_result)
      : data.cluster_result,
    aiAnalysis: data.ai_analysis,
    shareId: data.share_id,
    isPublic: data.is_public ?? false,
  };
}

export async function saveInvestigation(data: {
  id: string;
  target: string;
  targetName: string | null;
  clusterResult: unknown;
  aiAnalysis: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const result = data.clusterResult as { targetEthos?: { avatarUrl?: string } };

  const { error } = await supabase
    .from("investigations")
    .upsert({
      id: data.id,
      target: data.target,
      target_name: data.targetName,
      target_avatar: result?.targetEthos?.avatarUrl ?? null,
      cluster_result: data.clusterResult,
      ai_analysis: data.aiAnalysis,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    console.error("saveInvestigation error:", error);
    throw new Error(error.message);
  }
}

export async function deleteInvestigation(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("investigations")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("deleteInvestigation error:", error);
  }
}

export async function shareInvestigation(id: string): Promise<string | null> {
  const supabase = getSupabase();

  // Check if already has a share ID
  const { data: existing } = await supabase
    .from("investigations")
    .select("share_id")
    .eq("id", id)
    .single();

  if (existing?.share_id) {
    // Just make sure it's public
    await supabase
      .from("investigations")
      .update({ is_public: true })
      .eq("id", id);
    return existing.share_id;
  }

  // Generate a new share ID (22 chars from 36-char alphabet ≈ 114 bits of entropy)
  const shareId = nanoid(22);
  const { error } = await supabase
    .from("investigations")
    .update({ share_id: shareId, is_public: true })
    .eq("id", id);

  if (error) {
    console.error("shareInvestigation error:", error);
    return null;
  }

  return shareId;
}
