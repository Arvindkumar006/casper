import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Schema ─────────────────────────────────────────────────────────────────
export interface HistoricalAsset {
  assetId: string;
  timestamp: number;
  approved: boolean;
  riskIndex: number;
  amountCspr: number;
  deployHash?: string;
  // Extended evaluation fields (T1-07)
  gasUsed?: number;
  blockHeight?: number;
  confirmations?: number;
  reportHash?: string;   // SHA-256 of evaluation report (T2-02)
  // Asset metadata (stored on run so evaluation/explorer can resolve live fields)
  credit?: number;
  country?: string;
  valuation?: number;
  liveDataActive?: boolean;
  liveCsprPriceUsd?: number;
  riskNarrative?: string;
}

export interface MemoryData {
  totalRuns: number;
  successfulDeploys: number;
  confidenceScore: number;
  historicalAssets: HistoricalAsset[];
}

// ── Paths ──────────────────────────────────────────────────────────────────
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const DB_PATH = isVercel
  ? path.join(os.tmpdir(), 'history_db.json')
  : path.join(__dirname, '..', 'history_db.json');

// ── Clean-slate defaults — no hardcoded seed runs ─────────────────────────
// Confidence starts at 75 (neutral baseline) and adapts from real runs only.
const DEFAULT_MEMORY: MemoryData = {
  totalRuns: 0,
  successfulDeploys: 0,
  confidenceScore: 75,
  historicalAssets: []
};

// Global in-memory cache to sustain state across warm instances
let globalMemoryCache: MemoryData | null = null;

/**
 * Loads the current persistent memory from the local JSON database.
 */
export function loadMemory(): MemoryData {
  if (globalMemoryCache) {
    return globalMemoryCache;
  }

  try {
    if (isVercel && !fs.existsSync(DB_PATH)) {
      const searchPaths = [
        path.join(process.cwd(), 'history_db.json'),
        path.join(process.cwd(), 'agents', 'history_db.json'),
        path.join(__dirname, '..', 'history_db.json'),
        path.join(__dirname, '..', '..', 'history_db.json')
      ];

      let seeded = false;
      for (const p of searchPaths) {
        if (fs.existsSync(p)) {
          try {
            const content = fs.readFileSync(p, 'utf8');
            fs.writeFileSync(DB_PATH, content, 'utf8');
            seeded = true;
            break;
          } catch (_) {}
        }
      }
      if (!seeded) {
        fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_MEMORY, null, 2), 'utf8');
      }
    }

    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      globalMemoryCache = JSON.parse(raw);
      return globalMemoryCache!;
    }
  } catch (err: any) {
    console.error(`[Memory Engine] Error reading DB: ${err.message}. Restoring defaults.`);
  }

  globalMemoryCache = { ...DEFAULT_MEMORY, historicalAssets: [] };
  return globalMemoryCache;
}

/**
 * Saves the memory structure back to the local database file.
 */
export function saveMemory(data: MemoryData): void {
  globalMemoryCache = data;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err: any) {
    console.error(`[Memory Engine] Error saving DB: ${err.message}`);
  }
}

/**
 * Updates memory on run completion. Confidence adapts based on real outcomes:
 *   - Success: +5 points (capped at 100)
 *   - Failure: -15 points (floored at 0)
 */
export function updateMemory(
  assetId: string,
  approved: boolean,
  riskIndex: number,
  amountCspr: number,
  deploySuccess: boolean,
  deployHash?: string,
  extraFields?: Partial<HistoricalAsset>
): MemoryData {
  const memory = loadMemory();
  memory.totalRuns += 1;

  if (deploySuccess) {
    memory.successfulDeploys += 1;
    memory.confidenceScore = Math.min(100, memory.confidenceScore + 5);
  } else {
    memory.confidenceScore = Math.max(0, memory.confidenceScore - 15);
  }

  const histEntry: HistoricalAsset = {
    assetId,
    timestamp: Date.now(),
    approved,
    riskIndex,
    amountCspr,
    deployHash,
    ...extraFields
  };

  memory.historicalAssets.push(histEntry);
  saveMemory(memory);
  return memory;
}
