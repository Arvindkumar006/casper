import * as fs from 'fs';
import * as path from 'path';

export interface MemoryData {
  totalRuns: number;
  successfulDeploys: number;
  confidenceScore: number; // 0 to 100
  historicalAssets: Array<{
    assetId: string;
    timestamp: number;
    approved: boolean;
    riskIndex: number;
    amountCspr: number;
    deployHash?: string;
  }>;
}

const DB_PATH = path.join(__dirname, '..', 'history_db.json');

const DEFAULT_MEMORY: MemoryData = {
  totalRuns: 0,
  successfulDeploys: 0,
  confidenceScore: 80, // Default confidence is 80
  historicalAssets: []
};

/**
 * Loads the current persistent memory from the local JSON database.
 */
export function loadMemory(): MemoryData {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err: any) {
    console.error(`[Memory Engine] Error reading DB: ${err.message}. Restoring defaults.`);
  }
  return { ...DEFAULT_MEMORY };
}

/**
 * Saves the memory structure back to the local database file.
 */
export function saveMemory(data: MemoryData): void {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err: any) {
    console.error(`[Memory Engine] Error saving DB: ${err.message}`);
  }
}

/**
 * Updates memory on run completion, adapting the confidence score:
 * - Success: +5 points (max 100)
 * - Failure: -15 points (min 0)
 */
export function updateMemory(
  assetId: string,
  approved: boolean,
  riskIndex: number,
  amountCspr: number,
  deploySuccess: boolean,
  deployHash?: string
): MemoryData {
  const memory = loadMemory();
  memory.totalRuns += 1;

  if (deploySuccess) {
    memory.successfulDeploys += 1;
    memory.confidenceScore = Math.min(100, memory.confidenceScore + 5);
  } else {
    memory.confidenceScore = Math.max(0, memory.confidenceScore - 15);
  }

  memory.historicalAssets.push({
    assetId,
    timestamp: Date.now(),
    approved,
    riskIndex,
    amountCspr,
    deployHash
  });

  saveMemory(memory);
  return memory;
}
