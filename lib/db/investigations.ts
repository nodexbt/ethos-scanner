import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "investigations.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS investigations (
        id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        target_name TEXT,
        saved_at INTEGER NOT NULL,
        cluster_result TEXT NOT NULL,
        ai_analysis TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        investigation_id TEXT NOT NULL,
        address TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_screenshots_inv ON screenshots(investigation_id);
    `);
  }
  return _db;
}

export interface InvestigationRow {
  id: string;
  target: string;
  targetName: string | null;
  savedAt: number;
  clusterResult: unknown;
  aiAnalysis: string | null;
  screenshots: Record<string, string>;
}

export interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
  hasAnalysis: boolean;
  screenshotCount: number;
}

export function listInvestigations(): InvestigationSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      i.id, i.target, i.target_name, i.saved_at, i.cluster_result, i.ai_analysis,
      (SELECT COUNT(*) FROM screenshots s WHERE s.investigation_id = i.id) as screenshot_count
    FROM investigations i
    ORDER BY i.updated_at DESC
    LIMIT 100
  `).all() as {
    id: string;
    target: string;
    target_name: string | null;
    saved_at: number;
    cluster_result: string;
    ai_analysis: string | null;
    screenshot_count: number;
  }[];

  return rows.map((row) => {
    let strongCount = 0;
    let possibleCount = 0;
    try {
      const result = JSON.parse(row.cluster_result);
      strongCount = result.strongCluster?.length ?? 0;
      possibleCount = result.possibleCluster?.length ?? 0;
    } catch {}

    return {
      id: row.id,
      target: row.target,
      targetName: row.target_name,
      savedAt: row.saved_at,
      strongCount,
      possibleCount,
      hasAnalysis: !!row.ai_analysis,
      screenshotCount: row.screenshot_count,
    };
  });
}

export function getInvestigation(id: string): InvestigationRow | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, target, target_name, saved_at, cluster_result, ai_analysis
    FROM investigations WHERE id = ?
  `).get(id) as {
    id: string;
    target: string;
    target_name: string | null;
    saved_at: number;
    cluster_result: string;
    ai_analysis: string | null;
  } | undefined;

  if (!row) return null;

  const screenshotRows = db.prepare(`
    SELECT address, data FROM screenshots WHERE investigation_id = ?
  `).all(id) as { address: string; data: string }[];

  const screenshots: Record<string, string> = {};
  for (const s of screenshotRows) {
    screenshots[s.address] = s.data;
  }

  return {
    id: row.id,
    target: row.target,
    targetName: row.target_name,
    savedAt: row.saved_at,
    clusterResult: JSON.parse(row.cluster_result),
    aiAnalysis: row.ai_analysis,
    screenshots,
  };
}

export function saveInvestigation(data: {
  id: string;
  target: string;
  targetName: string | null;
  clusterResult: unknown;
  aiAnalysis: string | null;
  screenshots: Record<string, string>;
}): void {
  const db = getDb();
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO investigations (id, target, target_name, saved_at, cluster_result, ai_analysis, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cluster_result = excluded.cluster_result,
      ai_analysis = excluded.ai_analysis,
      updated_at = excluded.updated_at
  `);

  const deleteScreenshots = db.prepare(`DELETE FROM screenshots WHERE investigation_id = ?`);
  const insertScreenshot = db.prepare(`
    INSERT INTO screenshots (investigation_id, address, data) VALUES (?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    upsert.run(
      data.id,
      data.target,
      data.targetName,
      now,
      JSON.stringify(data.clusterResult),
      data.aiAnalysis,
      now
    );

    deleteScreenshots.run(data.id);
    for (const [address, dataUrl] of Object.entries(data.screenshots)) {
      insertScreenshot.run(data.id, address, dataUrl);
    }
  });

  transaction();
}

export function deleteInvestigation(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM screenshots WHERE investigation_id = ?`).run(id);
  db.prepare(`DELETE FROM investigations WHERE id = ?`).run(id);
}
