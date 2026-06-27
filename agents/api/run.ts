import type { VercelRequest, VercelResponse } from '@vercel/node';

// Asset classes and country codes for random generation
const ASSET_CLASSES = ['RealEstate', 'Solar', 'Agricultural', 'Infrastructure', 'Commodity'];
const COUNTRIES = ['US', 'CA', 'IN'];
const ALLOWED_COUNTRIES = new Set(['US', 'CA', 'IN']);
const MIN_CREDIT_SCORE = 600;
const MAX_RISK_THRESHOLD = 0.65;

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function simulatePipeline(customAsset?: any) {
  const steps: any[] = [];

  // 1. Oracle
  const assetId = customAsset?.assetId || `rwa_${randomBetween(100000, 999999)}`;
  const assetClass = ASSET_CLASSES[randomBetween(0, ASSET_CLASSES.length - 1)];
  const valuation = customAsset?.valuation || randomBetween(200000, 900000);
  const downPayment = Math.floor(valuation * 0.29);
  const borrowerCreditScore = customAsset?.borrowerCreditScore || randomBetween(550, 850);
  const countryCode = customAsset?.countryCode || COUNTRIES[randomBetween(0, COUNTRIES.length - 1)];
  const interestRate = (randomBetween(60, 120) / 10).toFixed(2);
  const marketTrend = (1 + randomBetween(0, 5) / 100).toFixed(2);

  const oracleData = { assetId, assetClass, valuation, downPayment, borrowerCreditScore, countryCode, interestRate, marketTrend };

  steps.push({
    step: '1',
    name: 'Oracle Data Ingestion',
    status: 'SUCCESS',
    data: oracleData
  });

  // 2. Compliance
  const violations: string[] = [];
  if (!ALLOWED_COUNTRIES.has(countryCode)) {
    violations.push(`Jurisdiction ${countryCode} is not in the whitelist (US, CA, IN)`);
  }
  if (borrowerCreditScore < MIN_CREDIT_SCORE) {
    violations.push(`Borrower credit score ${borrowerCreditScore} below minimum ${MIN_CREDIT_SCORE}`);
  }
  const compliant = violations.length === 0;
  const complianceData = {
    compliant,
    violations,
    agencyHash: compliant
      ? `COMPLIANCE_APPROVED:AGENCY_SWARM:${assetId}:${Date.now().toString(36).toUpperCase()}`
      : null
  };

  steps.push({
    step: '2',
    name: 'Compliance Verification',
    status: compliant ? 'SUCCESS' : 'FAILED',
    data: complianceData
  });

  // 3. Treasury
  const walletBalanceCspr = 2924;
  const allocatedAmountCspr = Math.min(500, Math.floor(walletBalanceCspr * 0.1));
  const treasuryData = {
    walletPublicKey: '013E2fA9cadCfcD097e02820025B24...',
    walletBalanceCspr,
    allocatedAmountCspr,
    allocatedAmountMotes: (allocatedAmountCspr * 1_000_000_000).toString(),
    isFallback: false
  };

  steps.push({
    step: '3',
    name: 'Treasury Audit',
    status: 'SUCCESS',
    data: treasuryData
  });

  // 4. Risk
  const ltv = (valuation - downPayment) / valuation;
  const creditFactor = Math.max(0, (850 - borrowerCreditScore) / 850);
  const riskIndex = compliant ? Math.min(1, ltv * 0.5 + creditFactor * 0.3 + parseFloat(interestRate) / 100 * 0.2) : 1;
  const approved = compliant && riskIndex <= MAX_RISK_THRESHOLD;

  const riskData = {
    riskIndex: parseFloat(riskIndex.toFixed(3)),
    acceptableRiskThreshold: MAX_RISK_THRESHOLD,
    approved,
    amount: (allocatedAmountCspr * 1_000_000_000).toString()
  };

  steps.push({
    step: '4',
    name: 'Risk Analyst Evaluation',
    status: approved ? 'SUCCESS' : 'FAILED',
    data: riskData
  });

  // 5. Execution
  let deployHash: string | undefined;
  let executionStatus = 'FAILED';

  if (approved) {
    deployHash = Array.from({ length: 64 }, () =>
      '0123456789abcdef'[randomBetween(0, 15)]
    ).join('');
    executionStatus = 'SUCCESS';
  }

  steps.push({
    step: '5',
    name: 'Swarm Capital Deployment',
    status: executionStatus,
    data: approved ? { deployHash } : { error: 'Aborted due to compliance/risk rejects.' }
  });

  return {
    oracle: steps[0],
    compliance: steps[1],
    treasury: steps[2],
    risk: steps[3],
    execution: steps[4],
    memory: {
      assetId,
      approved,
      riskIndex: parseFloat(riskIndex.toFixed(3)),
      amountCspr: approved ? allocatedAmountCspr : 0,
      deployHash
    }
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const customAsset = req.body && Object.keys(req.body).length > 0 ? req.body : undefined;
    const result = simulatePipeline(customAsset);
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
