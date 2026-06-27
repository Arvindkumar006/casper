import { RwaAssetData } from './oracle_agent';
import { ComplianceReport } from './compliance_agent';
import { TreasuryReport } from './treasury_agent';
import { loadMemory } from './memory_engine';

export interface ClearancePayload {
  assetId: string;
  amount: string;         // Allocated capital size in motes
  riskIndex: number;
  maxAcceptableRisk: number;
  approved: boolean;
  signature: string;      // Cryptographic mock signature
}

/**
 * Computes a composite Risk Index based on Loan-to-Value, local market trends,
 * compliance standing, and historical confidence parameters.
 */
export function analyzeRisk(
  asset: RwaAssetData,
  compliance: ComplianceReport,
  treasury: TreasuryReport
): ClearancePayload {
  // Load persistent confidence score from memory
  const memory = loadMemory();
  const confidence = memory.confidenceScore;

  // 1. Dynamic Risk Barrier Adjustment
  // Default maximum acceptable risk threshold is 0.8.
  // If confidence is low (< 70), dynamically scale down the acceptable risk barrier.
  const DEFAULT_RISK_BARRIER = 0.8;
  let maxAcceptableRisk = DEFAULT_RISK_BARRIER;
  
  if (confidence < 70) {
    // scale barrier down linearly with confidence (e.g. if confidence is 50, barrier = 0.8 * (50/70) = 0.57)
    maxAcceptableRisk = parseFloat((DEFAULT_RISK_BARRIER * (confidence / 70)).toFixed(3));
  }

  // 2. Risk Calculation (LTV + Trend Multiplier + Interest Rate Factor)
  const ltv = (asset.valuation - asset.downPayment) / asset.valuation;
  
  // High trend multiplier reduces risk (growth decreases default risk), interest rates increase financing risk
  // Risk Index = LTV * (1 / localMarketTrendMultiplier) * (1 + currentInterestRate)
  let riskIndex = ltv * (1.0 / asset.localMarketTrendMultiplier) * (1.0 + asset.currentInterestRate);
  
  // Format to 3 decimal places
  riskIndex = parseFloat(riskIndex.toFixed(3));

  // 3. Approval decision logic
  let approved = compliance.compliant && (riskIndex <= maxAcceptableRisk);
  
  // Safety override: if asset is on blacklist or compliance failed, risk index is forced to maximum (1.0)
  if (!compliance.compliant) {
    riskIndex = 1.0;
    approved = false;
  }

  const amountMotes = treasury.allocatedAmountMotes;

  // 4. Generate mock cryptographic clearance token
  const signature = approved
    ? `CLEARANCE_TOKEN:${asset.assetId}:${amountMotes}:RISK_${riskIndex}:CONF_${confidence}:${Date.now()}`
    : 'REJECTED:RISK_THRESHOLD_EXCEEDED';

  return {
    assetId: asset.assetId,
    amount: amountMotes,
    riskIndex,
    maxAcceptableRisk,
    approved,
    signature
  };
}
