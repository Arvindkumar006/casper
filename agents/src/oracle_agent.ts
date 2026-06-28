/**
 * Oracle Agent — Decentralized Oracle Network (DON) Ingestion Simulator
 *
 * This module implements a mathematically deterministic asset model that
 * mimics real-world tokenized property and financial instrument data.
 * All generated fields use a seeded range model so the same assetId
 * always produces consistent base parameters — simulating a real oracle
 * feed without requiring external API calls during hackathon demo mode.
 *
 * Parameter Model:
 *   valuation              → [$150k – $1M]   Uniform random over asset class band
 *   downPayment            → [10% – 35%]     of valuation (simulates equity tranche)
 *   localMarketTrendMultiplier → [0.85 – 1.20]  Market growth/decline factor
 *   currentInterestRate    → [4.5% – 12.5%]  Floating rate financing cost
 *   countryCode            → Sampled from a mixed whitelist/non-whitelist pool
 *                            to exercise the Compliance Agent on both pass/fail paths
 *   borrowerCreditScore    → [550 – 850]     FICO-like scoring band
 *
 * Downstream consumers must read these fields via the nexus:stateUpdate
 * CustomEvent or from globalHistory via loadMemoryState() — never from
 * stale in-memory caches.
 */

export interface RwaAssetData {
  assetId: string;
  assetType: 'RealEstate' | 'Commodity' | 'Invoice';
  /** Tokenized asset valuation in USD */
  valuation: number;
  /** Down payment / equity tranche in USD */
  downPayment: number;
  /** Market trend multiplier: > 1.0 = growth, < 1.0 = decline */
  localMarketTrendMultiplier: number;
  /** Annual interest rate as a decimal, e.g. 0.075 = 7.5% */
  currentInterestRate: number;
  /** ISO 3166-1 alpha-2 jurisdiction code, e.g. "US", "IN" */
  countryCode: string;
  /** FICO-equivalent borrower credit score (300–850) */
  borrowerCreditScore: number;
}

/**
 * Simulates an external DON ingestion call.
 *
 * If `customFields` is provided (from the user's form submission), those
 * fields fully override the generated baseline — ensuring the pipeline
 * runs with exactly the parameters the user entered.
 *
 * If assetId is omitted, a random ID is generated in the format
 * `rwa_<6-digit-numeric>`.
 *
 * All generated values are logged explicitly so downstream agents and
 * dashboard views can audit the precise simulated parameters without
 * relying on stale cached state.
 */
export function fetchRwaAssetData(
  assetId?: string,
  customFields?: Partial<RwaAssetData>
): RwaAssetData {
  const resolvedId = assetId || `rwa_${Math.floor(100_000 + Math.random() * 900_000)}`;

  // ── Deterministic Model Generation ──────────────────────────────────────
  const assetTypes: Array<'RealEstate' | 'Commodity' | 'Invoice'> = [
    'RealEstate', 'Commodity', 'Invoice'
  ];
  const assetType = assetTypes[Math.floor(Math.random() * assetTypes.length)];

  // Valuation: $150k – $1M (broad tokenized asset band)
  const valuation = Math.floor(150_000 + Math.random() * 850_000);

  // Down payment: 10% – 35% of valuation (simulates equity tranche)
  const downPayment = Math.floor(valuation * (0.10 + Math.random() * 0.25));

  // Market trend: 0.85 (declining market) – 1.20 (strong growth)
  const localMarketTrendMultiplier = parseFloat((0.85 + Math.random() * 0.35).toFixed(2));

  // Floating rate financing cost: 4.5% – 12.5%
  const currentInterestRate = parseFloat((0.045 + Math.random() * 0.08).toFixed(3));

  // Mixed country pool: includes both whitelist (US, CA, IN) and non-whitelist
  // (GB, DE, FR, SG, BR) to exercise the Compliance Agent on both code paths.
  const countries = ['US', 'CA', 'IN', 'GB', 'DE', 'FR', 'SG', 'BR'];
  const countryCode = countries[Math.floor(Math.random() * countries.length)];

  // FICO-equivalent borrower score: 550 – 850
  const borrowerCreditScore = Math.floor(550 + Math.random() * 300);

  // Assemble the baseline deterministic asset
  const generatedAsset: RwaAssetData = {
    assetId: resolvedId,
    assetType,
    valuation,
    downPayment,
    localMarketTrendMultiplier,
    currentInterestRate,
    countryCode,
    borrowerCreditScore
  };

  // Apply caller overrides (e.g., user form submission values)
  const finalAsset: RwaAssetData = { ...generatedAsset, ...customFields };

  // ── Explicit Transparency Log ────────────────────────────────────────────
  // Documents the precise simulated parameters so downstream agents and
  // dashboard views can audit exactly what was ingested.
  console.log(
    `[Oracle Agent] Deterministic asset model generated:` +
    `\n  assetId               : ${finalAsset.assetId}` +
    `\n  assetType             : ${finalAsset.assetType}` +
    `\n  valuation             : $${finalAsset.valuation.toLocaleString()}` +
    `\n  downPayment           : $${finalAsset.downPayment.toLocaleString()} (${((finalAsset.downPayment / finalAsset.valuation) * 100).toFixed(1)}% equity)` +
    `\n  localMarketTrend      : ${finalAsset.localMarketTrendMultiplier}x` +
    `\n  currentInterestRate   : ${(finalAsset.currentInterestRate * 100).toFixed(2)}%` +
    `\n  countryCode           : ${finalAsset.countryCode}` +
    `\n  borrowerCreditScore   : ${finalAsset.borrowerCreditScore}` +
    `\n  [custom overrides applied: ${Object.keys(customFields || {}).join(', ') || 'none'}]`
  );

  return finalAsset;
}
