import * as path from 'path';
import { RwaAssetData } from './oracle_agent';

// ── Configuration Layer ────────────────────────────────────────────────────
// All jurisdiction rules and blacklists are loaded from config/compliance.json.
// Modify that file to update compliance rules without changing agent code.
const complianceConfig = require(path.join(__dirname, '..', 'config', 'compliance.json'));

const ALLOWED_COUNTRIES: string[]  = complianceConfig.allowedCountries;
const ASSET_BLACKLIST: string[]    = complianceConfig.assetBlacklist;
const MIN_CREDIT_SCORE: number     = complianceConfig.underwriting.minimumBorrowerCreditScore;

// ── Interfaces ─────────────────────────────────────────────────────────────
export interface ComplianceReport {
  compliant: boolean;
  violations: string[];
  agencySignature: string;
}

/**
 * Programmatically validates structural compliance rules for RWAs.
 *
 * Rule set loaded from config/compliance.json:
 *   1. Allowed jurisdictions   — ALLOWED_COUNTRIES array
 *   2. Global blacklist check  — ASSET_BLACKLIST array
 *   3. Minimum borrower FICO   — underwriting.minimumBorrowerCreditScore
 */
export function validateCompliance(asset: RwaAssetData): ComplianceReport {
  const violations: string[] = [];

  // 1. Jurisdiction check
  if (!ALLOWED_COUNTRIES.includes(asset.countryCode)) {
    violations.push(
      `Jurisdiction "${asset.countryCode}" is not in the approved whitelist [${ALLOWED_COUNTRIES.join(', ')}]`
    );
  }

  // 2. Blacklist check
  if (ASSET_BLACKLIST.includes(asset.assetId)) {
    violations.push(
      `Asset "${asset.assetId}" is explicitly blacklisted in the global compliance registry`
    );
  }

  // 3. Underwriting credit criteria
  if (asset.borrowerCreditScore < MIN_CREDIT_SCORE) {
    violations.push(
      `Borrower FICO score ${asset.borrowerCreditScore} is below the underwriting floor of ${MIN_CREDIT_SCORE}`
    );
  }

  const compliant = violations.length === 0;

  // Programmatic agency validation token
  const agencySignature = compliant
    ? `COMPLIANCE_APPROVED:AGENCY_SWARM:${asset.assetId}:${Date.now()}`
    : 'COMPLIANCE_REJECTED';

  return { compliant, violations, agencySignature };
}
