/**
 * Asset Registry — NexusVault Asset Lifecycle Manager
 *
 * Owns the canonical schema for user-created RWA assets and provides
 * CRUD operations against a persistent `assets_db.json` store.
 *
 * Asset Lifecycle:
 *   Draft → Evaluating → Approved | Rejected → Deploying → Confirmed → Archived
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Status Lifecycle ───────────────────────────────────────────────────────
export type AssetStatus =
  | 'Draft'
  | 'Evaluating'
  | 'Approved'
  | 'Rejected'
  | 'Deploying'
  | 'Confirmed'
  | 'Archived';

// ── Asset Schema ───────────────────────────────────────────────────────────
export interface NexusAsset {
  /** Slug-safe unique identifier, e.g. "rwa_dubai_tower_001" */
  assetId: string;
  /** Human-readable display name */
  assetName: string;
  assetType: 'RealEstate' | 'Commodity' | 'Invoice';
  /** Tokenized asset valuation in USD */
  valuation: number;
  /** Down payment / equity tranche in USD */
  downPayment: number;
  /** ISO 3166-1 alpha-2 jurisdiction code */
  countryCode: string;
  /** FICO-equivalent borrower credit score (300–850) */
  borrowerCreditScore: number;
  /** Annual interest rate as a decimal, e.g. 0.075 */
  currentInterestRate: number;
  /** Current lifecycle status */
  status: AssetStatus;
  /** Public key of the wallet that created this asset */
  ownerAddress: string;
  createdAt: number;
  updatedAt: number;
  // Populated after evaluation
  riskIndex?: number;
  riskNarrative?: string;
  reportHash?: string;
  deployHash?: string;
  blockHeight?: number;
  confirmations?: number;
  gasUsed?: number;
  allocatedCspr?: number;
  liveCsprPriceUsd?: number;
  liveDataActive?: boolean;
  evaluatedAt?: number;
  deployedAt?: number;
}

// ── Paths ──────────────────────────────────────────────────────────────────
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const ASSETS_DB_PATH = isVercel
  ? path.join(os.tmpdir(), 'assets_db.json')
  : path.join(__dirname, '..', 'assets_db.json');

let assetsCache: NexusAsset[] | null = null;

// ── Registry Helpers ───────────────────────────────────────────────────────

function seedAssetsDb(): NexusAsset[] {
  // Attempt to load bundled seed file (for Vercel cold starts)
  const searchPaths = [
    path.join(process.cwd(), 'assets_db.json'),
    path.join(process.cwd(), 'agents', 'assets_db.json'),
    path.join(__dirname, '..', 'assets_db.json')
  ];
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_) {}
    }
  }
  return [];
}

/**
 * Loads all assets from the registry store.
 */
export function loadAssets(): NexusAsset[] {
  if (assetsCache) return assetsCache;

  try {
    if (isVercel && !fs.existsSync(ASSETS_DB_PATH)) {
      const seeded = seedAssetsDb();
      fs.writeFileSync(ASSETS_DB_PATH, JSON.stringify(seeded, null, 2), 'utf8');
      assetsCache = seeded;
      return assetsCache;
    }

    if (fs.existsSync(ASSETS_DB_PATH)) {
      assetsCache = JSON.parse(fs.readFileSync(ASSETS_DB_PATH, 'utf8'));
      return assetsCache!;
    }
  } catch (err: any) {
    console.error(`[Asset Registry] Load error: ${err.message}`);
  }

  assetsCache = [];
  return assetsCache;
}

/**
 * Saves the full assets array to the registry store.
 */
export function saveAssets(assets: NexusAsset[]): void {
  assetsCache = assets;
  try {
    const dir = path.dirname(ASSETS_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ASSETS_DB_PATH, JSON.stringify(assets, null, 2), 'utf8');
  } catch (err: any) {
    console.error(`[Asset Registry] Save error: ${err.message}`);
  }
}

/**
 * Creates a new asset in Draft status.
 * Throws if an asset with the same ID already exists.
 */
export function createAsset(input: Omit<NexusAsset, 'status' | 'createdAt' | 'updatedAt'>): NexusAsset {
  const assets = loadAssets();

  if (assets.find(a => a.assetId === input.assetId)) {
    throw new Error(`Asset with ID "${input.assetId}" already exists`);
  }

  const now = Date.now();
  const asset: NexusAsset = {
    ...input,
    status: 'Draft',
    createdAt: now,
    updatedAt: now
  };

  assets.push(asset);
  saveAssets(assets);
  return asset;
}

/**
 * Updates an existing asset by ID, merging the provided partial fields.
 * Automatically updates `updatedAt`.
 */
export function upsertAsset(assetId: string, updates: Partial<NexusAsset>): NexusAsset {
  const assets = loadAssets();
  const idx = assets.findIndex(a => a.assetId === assetId);

  if (idx === -1) {
    throw new Error(`Asset "${assetId}" not found in registry`);
  }

  assets[idx] = { ...assets[idx], ...updates, updatedAt: Date.now() };
  saveAssets(assets);
  return assets[idx];
}

/**
 * Finds a single asset by ID. Returns undefined if not found.
 */
export function findAsset(assetId: string): NexusAsset | undefined {
  return loadAssets().find(a => a.assetId === assetId);
}
