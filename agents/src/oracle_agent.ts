export interface RwaAssetData {
  assetId: string;
  assetType: 'RealEstate' | 'Commodity' | 'Invoice';
  valuation: number;                // In USD
  downPayment: number;              // In USD
  localMarketTrendMultiplier: number; // Factor representing growth/decline (e.g., 1.05)
  currentInterestRate: number;      // e.g., 0.075 for 7.5%
  countryCode: string;              // e.g., "US", "CA", "IN", "DE", etc.
  borrowerCreditScore: number;      // FICO-like rating (300-850)
}

/**
 * Mocks an external decentralized oracle network (DON) ingestion system
 * and returns details for a requested or dynamically generated RWA asset.
 */
export function fetchRwaAssetData(assetId?: string): RwaAssetData {
  const defaultAssetId = assetId || `rwa_${Math.floor(100000 + Math.random() * 900000)}`;
  
  // Randomize some realistic parameters
  const assetTypes: Array<'RealEstate' | 'Commodity' | 'Invoice'> = ['RealEstate', 'Commodity', 'Invoice'];
  const assetType = assetTypes[Math.floor(Math.random() * assetTypes.length)];
  
  const valuation = Math.floor(150000 + Math.random() * 850000); // $150k - $1M
  const downPayment = Math.floor(valuation * (0.10 + Math.random() * 0.25)); // 10% to 35% down payment
  
  // Trend factor between 0.85 (declining) and 1.20 (strong growth)
  const localMarketTrendMultiplier = parseFloat((0.85 + Math.random() * 0.35).toFixed(2));
  
  // Interest rate between 4.5% and 12.5%
  const currentInterestRate = parseFloat((0.045 + Math.random() * 0.08).toFixed(3));
  
  // Country codes: mix of compliant and non-compliant countries for compliance tests
  const countries = ['US', 'CA', 'IN', 'GB', 'DE', 'FR', 'SG', 'BR'];
  const countryCode = countries[Math.floor(Math.random() * countries.length)];
  
  // Credit score between 550 and 850
  const borrowerCreditScore = Math.floor(550 + Math.random() * 300);

  return {
    assetId: defaultAssetId,
    assetType,
    valuation,
    downPayment,
    localMarketTrendMultiplier,
    currentInterestRate,
    countryCode,
    borrowerCreditScore
  };
}
