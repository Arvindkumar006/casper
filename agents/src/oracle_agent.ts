/**
 * Oracle Agent — LIVE Decentralized Oracle Network (DON) Ingestion Engine
 *
 * The oracle's sole responsibility is to ENRICH an existing asset with live
 * market data. It does NOT generate asset metadata. All asset parameters
 * (valuation, credit score, interest rate, country, down payment) are owned
 * by the Asset Registry and supplied by the user before pipeline execution.
 *
 * ── What the Oracle adds ──────────────────────────────────────────────────
 *   localMarketTrendMultiplier — derived from the LIVE CSPR/USD price via
 *   the CoinGecko Simple Price API. This is the only externally sourced value.
 *   The multiplier feeds directly into the Risk Analyst LTV equation:
 *     riskIndex = LTV × (1 / trendMultiplier) × (1 + interestRate)
 *
 * ── Live Data Source ──────────────────────────────────────────────────────
 *   Endpoint  : https://api.coingecko.com/api/v3/simple/price
 *   Parameters: ids=casper-network, vs_currencies=usd
 *   Auth      : None (public free tier)
 *
 * ── Trend Multiplier Formula ──────────────────────────────────────────────
 *   Reference price : $0.02 USD (stable CSPR baseline)
 *   multiplier = clamp(0.85 + (liveCsprPrice / $0.02) × 0.175, 0.85, 1.20)
 *   At $0.02 (reference): ~1.025 (neutral market)
 *   At $0.04 (2× ref):     1.20  (strong growth — capped)
 *   At $0.01 (0.5× ref):   ~0.94 (mild decline)
 *
 * ── Fallback ──────────────────────────────────────────────────────────────
 *   If CoinGecko is unavailable, the trend multiplier falls back to a
 *   deterministic mid-band value (1.025) and the pipeline continues.
 */

import * as path from 'path';

// ── Config ─────────────────────────────────────────────────────────────────
const complianceConfig = require(path.join(__dirname, '..', 'config', 'compliance.json'));

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=casper-network&vs_currencies=usd';

const CSPR_REFERENCE_PRICE_USD = 0.02;
const TREND_MIN = 0.85;
const TREND_MAX = 1.20;
const TREND_NEUTRAL = 1.025; // Used as fallback when API is unavailable
const ORACLE_FETCH_TIMEOUT_MS: number = complianceConfig.network.rpcTimeoutMs || 4000;

// ── Interface ──────────────────────────────────────────────────────────────
export interface RwaAssetData {
  assetId: string;
  assetType: 'RealEstate' | 'Commodity' | 'Invoice';
  /** User-supplied tokenized asset valuation in USD */
  valuation: number;
  /** User-supplied down payment / equity tranche in USD */
  downPayment: number;
  /**
   * LIVE market trend multiplier derived from the CoinGecko CSPR/USD feed.
   * This is the ONLY oracle-generated value — all other fields come from the user.
   * > 1.0 = growing collateral market (lower risk)
   * < 1.0 = declining collateral market (higher risk)
   */
  localMarketTrendMultiplier: number;
  /** User-supplied annual interest rate as a decimal */
  currentInterestRate: number;
  /** User-supplied ISO 3166-1 alpha-2 jurisdiction code */
  countryCode: string;
  /** User-supplied FICO-equivalent borrower credit score */
  borrowerCreditScore: number;
  /** Live CSPR/USD spot price at ingestion time (0 if API unavailable) */
  liveCsprPriceUsd: number;
  /** True when the trend multiplier was derived from the live CoinGecko feed */
  liveDataActive: boolean;
}

// ── Live CSPR Price Fetcher ────────────────────────────────────────────────

async function fetchLiveCsprPrice(): Promise<number | null> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), ORACLE_FETCH_TIMEOUT_MS)
  );

  const fetcher = (async (): Promise<number | null> => {
    const res = await fetch(COINGECKO_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'NexusVault-Oracle/1.0' }
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json() as Record<string, { usd?: number }>;
    const price = data['casper-network']?.usd;
    if (typeof price !== 'number' || price <= 0) {
      throw new Error(`Invalid price in response: ${JSON.stringify(data)}`);
    }
    return price;
  })();

  return Promise.race([fetcher, timeout]);
}

function deriveTrendMultiplier(csprPrice: number): number {
  const raw = TREND_MIN + (csprPrice / CSPR_REFERENCE_PRICE_USD) * 0.175;
  return parseFloat(Math.min(TREND_MAX, Math.max(TREND_MIN, raw)).toFixed(3));
}

// ── Main Enrichment Function ───────────────────────────────────────────────

/**
 * Enriches a user-submitted asset record with live market data from CoinGecko.
 *
 * IMPORTANT: This function does NOT generate any asset metadata. Every field
 * (valuation, downPayment, countryCode, borrowerCreditScore, currentInterestRate)
 * must be supplied by the caller — taken directly from the Asset Registry entry
 * created by the user.
 *
 * The only value this function contributes is `localMarketTrendMultiplier`,
 * which is derived from the live CSPR/USD price.
 *
 * @param userAsset  Complete asset data from the user/registry. All fields required.
 */
export async function enrichAssetWithOracle(userAsset: {
  assetId: string;
  assetType: 'RealEstate' | 'Commodity' | 'Invoice';
  valuation: number;
  downPayment: number;
  countryCode: string;
  borrowerCreditScore: number;
  currentInterestRate: number;
}): Promise<RwaAssetData> {

  // ── Live Market Enrichment ────────────────────────────────────────────────
  let liveCsprPrice = 0;
  let liveDataActive = false;
  let localMarketTrendMultiplier = TREND_NEUTRAL;

  try {
    const fetched = await fetchLiveCsprPrice();
    if (fetched !== null) {
      liveCsprPrice = fetched;
      localMarketTrendMultiplier = deriveTrendMultiplier(liveCsprPrice);
      liveDataActive = true;
      console.log(
        `[Oracle] ✅ Live feed: CSPR/USD = $${liveCsprPrice} → trendMultiplier = ${localMarketTrendMultiplier}`
      );
    } else {
      throw new Error(`Timed out after ${ORACLE_FETCH_TIMEOUT_MS}ms`);
    }
  } catch (err: any) {
    console.warn(
      `[Oracle] ⚠️  CoinGecko unavailable (${err.message}). ` +
      `Using neutral trend multiplier: ${TREND_NEUTRAL}`
    );
  }

  const enriched: RwaAssetData = {
    // ── All fields come directly from the user's submitted asset ──────────
    assetId:              userAsset.assetId,
    assetType:            userAsset.assetType,
    valuation:            userAsset.valuation,
    downPayment:          userAsset.downPayment,
    countryCode:          userAsset.countryCode,
    borrowerCreditScore:  userAsset.borrowerCreditScore,
    currentInterestRate:  userAsset.currentInterestRate,
    // ── Oracle-contributed live market data ───────────────────────────────
    localMarketTrendMultiplier,
    liveCsprPriceUsd:     liveCsprPrice,
    liveDataActive
  };

  console.log(
    `[Oracle] Enrichment complete for "${enriched.assetId}":` +
    `\n  valuation           : $${enriched.valuation.toLocaleString()} (user-supplied)` +
    `\n  downPayment         : $${enriched.downPayment.toLocaleString()} (user-supplied)` +
    `\n  countryCode         : ${enriched.countryCode} (user-supplied)` +
    `\n  borrowerCreditScore : ${enriched.borrowerCreditScore} (user-supplied)` +
    `\n  currentInterestRate : ${(enriched.currentInterestRate * 100).toFixed(2)}% (user-supplied)` +
    `\n  trendMultiplier     : ${enriched.localMarketTrendMultiplier} (oracle LIVE=${liveDataActive})` +
    `\n  liveCsprPriceUsd    : $${enriched.liveCsprPriceUsd}`
  );

  return enriched;
}

// ── Backward-compatible alias for swarm_executor ───────────────────────────
// When no user asset is available (standalone CLI run), falls back to a
// sensible neutral dataset so the pipeline can still execute for testing.
export async function fetchRwaAssetData(
  assetId?: string,
  customFields?: Partial<RwaAssetData>
): Promise<RwaAssetData> {
  if (customFields && Object.keys(customFields).length > 0) {
    // User provided data — use enrichment path
    return enrichAssetWithOracle({
      assetId:              assetId || customFields.assetId || `rwa_${Date.now().toString(36)}`,
      assetType:            customFields.assetType || 'RealEstate',
      valuation:            customFields.valuation || 500_000,
      downPayment:          customFields.downPayment || 100_000,
      countryCode:          customFields.countryCode || 'US',
      borrowerCreditScore:  customFields.borrowerCreditScore || 700,
      currentInterestRate:  customFields.currentInterestRate || 0.065,
    });
  }

  // Standalone mode — enrich a neutral baseline so CLI runs don't break
  return enrichAssetWithOracle({
    assetId:             assetId || `rwa_${Date.now().toString(36)}`,
    assetType:           'RealEstate',
    valuation:           500_000,
    downPayment:         100_000,
    countryCode:         'US',
    borrowerCreditScore: 700,
    currentInterestRate: 0.065,
  });
}
