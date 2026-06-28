import { RwaAssetData } from './oracle_agent';
import { ComplianceReport } from './compliance_agent';
import { TreasuryReport } from './treasury_agent';
import { loadMemory } from './memory_engine';
import * as path from 'path';

const complianceConfig = require(path.join(__dirname, '..', 'config', 'compliance.json'));
const DEFAULT_RISK_BARRIER: number = complianceConfig.underwriting.maxRiskBarrier;

export interface ClearancePayload {
  assetId: string;
  amount: string;
  riskIndex: number;
  maxAcceptableRisk: number;
  approved: boolean;
  signature: string;
  // Multi-factor sub-scores (T2-01)
  subScores: {
    ltvScore: number;
    marketTrendScore: number;
    interestRateScore: number;
    creditScore: number;
    compositeRisk: number;
  };
  /** Human-readable narrative of the risk decision */
  narrative: string;
}

/**
 * Computes a multi-factor composite Risk Index using a weighted scoring model.
 *
 * ── Weight Distribution ────────────────────────────────────────────────────
 *   LTV Score          40% — Loan-to-Value ratio (primary default risk driver)
 *   Market Trend Score 25% — Live CSPR/USD collateral market direction
 *   Interest Rate Score 20% — Financing cost sensitivity
 *   Credit Score       15% — Borrower repayment capacity (FICO-normalised)
 *
 * ── Confidence Adaptive Barrier ───────────────────────────────────────────
 *   If the system's accumulated confidence score drops below 70, the
 *   maximum acceptable risk barrier scales down linearly, tightening
 *   the approval threshold as the system learns from failures.
 */
export function analyzeRisk(
  asset: RwaAssetData,
  compliance: ComplianceReport,
  treasury: TreasuryReport
): ClearancePayload {
  const memory = loadMemory();
  const confidence = memory.confidenceScore;

  // ── 1. Confidence-Adaptive Risk Barrier ──────────────────────────────────
  let maxAcceptableRisk = DEFAULT_RISK_BARRIER;
  if (confidence < 70) {
    maxAcceptableRisk = parseFloat((DEFAULT_RISK_BARRIER * (confidence / 70)).toFixed(3));
  }

  // ── 2. Multi-Factor Sub-Scores (all normalised to 0–1) ───────────────────

  // LTV Score (40%): higher LTV = higher default risk
  const ltv = (asset.valuation - asset.downPayment) / asset.valuation;
  const ltvScore = parseFloat(ltv.toFixed(3));

  // Market Trend Score (25%): inverse multiplier — declining market raises risk
  // trendMultiplier 0.85 (declining) → trend risk 1.18, 1.20 (growth) → 0.83
  const marketTrendScore = parseFloat((1.0 / asset.localMarketTrendMultiplier).toFixed(3));

  // Interest Rate Score (20%): direct financing cost component
  // Scaled to 0–1 band relative to max observed rate of 12.5%
  const interestRateScore = parseFloat(Math.min(1.0, asset.currentInterestRate / 0.125).toFixed(3));

  // Credit Score (15%): inverse FICO normalisation — lower FICO = higher risk
  // 300 (floor) → 1.0 risk,  850 (ceiling) → 0.0 risk
  const ficoBand = Math.min(850, Math.max(300, asset.borrowerCreditScore));
  const creditScore = parseFloat(((850 - ficoBand) / 550).toFixed(3));

  // ── 3. Composite Weighted Risk Index ─────────────────────────────────────
  const compositeRisk = parseFloat(
    (ltvScore * 0.40 + marketTrendScore * 0.25 + interestRateScore * 0.20 + creditScore * 0.15).toFixed(3)
  );

  let riskIndex = compositeRisk;

  // ── 4. Compliance Override ────────────────────────────────────────────────
  // Compliance failure forces risk to maximum — no approval possible.
  if (!compliance.compliant) {
    riskIndex = 1.0;
  }

  const approved = compliance.compliant && riskIndex <= maxAcceptableRisk;
  const amountMotes = treasury.allocatedAmountMotes;

  // ── 5. Decision Narrative ─────────────────────────────────────────────────
  const narrativeLines: string[] = [];
  narrativeLines.push(`Composite Risk Index: ${riskIndex.toFixed(3)} (threshold: ${maxAcceptableRisk})`);
  narrativeLines.push(`LTV: ${(ltv * 100).toFixed(1)}% → sub-score ${ltvScore} [40% weight]`);
  narrativeLines.push(`Market Trend: ${asset.localMarketTrendMultiplier}× (CSPR $${asset.liveCsprPriceUsd || 'N/A'}) → ${marketTrendScore} [25% weight]`);
  narrativeLines.push(`Interest Rate: ${(asset.currentInterestRate * 100).toFixed(2)}% → ${interestRateScore} [20% weight]`);
  narrativeLines.push(`Borrower FICO: ${asset.borrowerCreditScore} → risk factor ${creditScore} [15% weight]`);
  if (!compliance.compliant) {
    narrativeLines.push(`COMPLIANCE FAIL: Risk overridden to 1.0. Violations: ${compliance.violations.join('; ')}`);
  }
  narrativeLines.push(`System Confidence: ${confidence}/100 — adaptive barrier: ${maxAcceptableRisk}`);
  narrativeLines.push(`Decision: ${approved ? 'APPROVED' : 'REJECTED'}`);
  const narrative = narrativeLines.join('\n');

  // ── 6. Clearance Signature ────────────────────────────────────────────────
  const signature = approved
    ? `CLEARANCE_TOKEN:${asset.assetId}:${amountMotes}:RISK_${riskIndex}:CONF_${confidence}:${Date.now()}`
    : `REJECTED:RISK_${riskIndex}_EXCEEDS_${maxAcceptableRisk}`;

  return {
    assetId: asset.assetId,
    amount: amountMotes,
    riskIndex,
    maxAcceptableRisk,
    approved,
    signature,
    subScores: {
      ltvScore,
      marketTrendScore,
      interestRateScore,
      creditScore,
      compositeRisk
    },
    narrative
  };
}
