import { RwaAssetData } from './oracle_agent';

export interface ComplianceReport {
  compliant: boolean;
  violations: string[];
  agencySignature: string;
}

// Mock structural blacklist of risky/bad assets
const MOCK_ASSET_BLACKLIST = [
  'rwa_blacklist_01',
  'rwa_blacklist_02',
  'rwa_property_chicago_666',
  'rwa_toxic_debt_99'
];

// Allowed country codes for deployment
const ALLOWED_COUNTRIES = ['US', 'CA', 'IN'];

/**
 * Programmatically validates structural compliance rules for RWAs.
 * Checks:
 * 1. Allowed jurisdictions (US, CA, IN)
 * 2. ID comparison against the global blacklist registry
 * 3. Minimum borrower credit score (e.g. 600)
 */
export function validateCompliance(asset: RwaAssetData): ComplianceReport {
  const violations: string[] = [];

  // 1. Jurisdiction check
  if (!ALLOWED_COUNTRIES.includes(asset.countryCode)) {
    violations.push(`Jurisdiction ${asset.countryCode} is not in the whitelist of allowed countries (${ALLOWED_COUNTRIES.join(', ')})`);
  }

  // 2. Blacklist check
  if (MOCK_ASSET_BLACKLIST.includes(asset.assetId)) {
    violations.push(`Asset ${asset.assetId} is explicitly blacklisted in the global compliance database`);
  }

  // 3. Underwriting criteria check (credit rating)
  if (asset.borrowerCreditScore < 600) {
    violations.push(`Borrower credit score of ${asset.borrowerCreditScore} is below the underwriting limit of 600`);
  }

  const compliant = violations.length === 0;
  
  // Generating a programmatic agency validation token
  const agencySignature = compliant 
    ? `COMPLIANCE_APPROVED:AGENCY_SWARM:${asset.assetId}:${Date.now()}`
    : 'COMPLIANCE_REJECTED';

  return {
    compliant,
    violations,
    agencySignature
  };
}
