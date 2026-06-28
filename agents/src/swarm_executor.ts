import * as fs from 'fs';
import * as path from 'path';
import { 
  CasperClient, 
  DeployUtil, 
  RuntimeArgs, 
  CLValueBuilder, 
  Keys, 
  decodeBase16 
} from 'casper-js-sdk';

import { loadMemory, saveMemory, updateMemory, MemoryData } from './memory_engine';
import { fetchRwaAssetData, RwaAssetData } from './oracle_agent';
import { validateCompliance, ComplianceReport } from './compliance_agent';
import { auditTreasury, TreasuryReport } from './treasury_agent';
import { analyzeRisk, ClearancePayload } from './risk_analyst';

import * as crypto from 'crypto';
import * as os from 'os';

// ── Configuration Layer ──────────────────────────────────────────────────
const complianceConfig = require(path.join(__dirname, '..', 'config', 'compliance.json'));

// Odra Contract Hash on Casper Testnet
const CONTRACT_HASH = process.env.CONTRACT_HASH || 'hash-184250acf2daff732850c0e14b582fcfaf0c1b7b2f60248c0f362e4d63b8f843';
const NODE_RPC_URL: string = complianceConfig.network.nodeRpcUrl;
const PAYMENT_MOTES: number = complianceConfig.network.deploymentPaymentMotes;

// Key paths (writable on Vercel via /tmp)
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const PRIVATE_KEY_PATH = isVercel
  ? path.join(os.tmpdir(), 'mock_private_key.pem')
  : path.join(__dirname, '..', 'mock_private_key.pem');
const PUBLIC_KEY_PATH = isVercel
  ? path.join(os.tmpdir(), 'mock_public_key.pem')
  : path.join(__dirname, '..', 'mock_public_key.pem');

export interface PipelineStepResult {
  step: string;
  name: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  data: any;
}

export interface PipelineRunResult {
  oracle: PipelineStepResult;
  compliance: PipelineStepResult;
  treasury: PipelineStepResult;
  risk: PipelineStepResult;
  execution: PipelineStepResult;
  memory: MemoryData;
  reportHash: string;
}


/**
 * Loads the local Casper Ed25519 keypair from the filesystem.
 * Generates and saves a new keypair if it does not already exist.
 */
export function getOrCreateKeyPair(): Keys.AsymmetricKey {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.log(`[Swarm Key manager] Key file not found. Generating a new mock Ed25519 keypair at ${PRIVATE_KEY_PATH}...`);
    const keyPair = Keys.Ed25519.new();
    
    // Save to filesystem in PEM format
    const privateKeyPem = keyPair.exportPrivateKeyInPem();
    const publicKeyPem = keyPair.exportPublicKeyInPem();
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKeyPem);
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKeyPem);
    
    return keyPair;
  }
  
  return Keys.Ed25519.loadKeyPairFromPrivateFile(PRIVATE_KEY_PATH);
}

/**
 * Broadcasts the deploy_capital session call to the NexusVault contract on Casper Testnet.
 */
async function executeContractCall(
  assetId: string,
  amountMotes: string,
  valuation: number,
  riskScore: number,
  keyPair: Keys.AsymmetricKey
): Promise<string> {
  const publicKey = keyPair.publicKey;
  const client = new CasperClient(NODE_RPC_URL);

  // Construct runtime arguments matching our Odra smart contract definition
  const args = RuntimeArgs.fromMap({
    asset_id: CLValueBuilder.string(assetId),
    amount: CLValueBuilder.u256(amountMotes),
    valuation: CLValueBuilder.u256(valuation),
    risk_score: CLValueBuilder.u256(riskScore),
  });

  // Decode the hex hash into bytes (removing prefix if present)
  const cleanHashHex = CONTRACT_HASH.startsWith('hash-') ? CONTRACT_HASH.slice(5) : CONTRACT_HASH;
  const contractHashBytes = decodeBase16(cleanHashHex);

  // Construct stored contract session call
  const session = DeployUtil.ExecutableDeployItem.newStoredContractByHash(
    contractHashBytes,
    'deploy_capital',
    args
  );

  // Define payment (from config — avoids hardcoded literals)
  const payment = DeployUtil.standardPayment(PAYMENT_MOTES);

  // Build Deploy Parameters
  const deployParams = new DeployUtil.DeployParams(
    publicKey,
    'casper-test',
    1, // gasPrice
    1800000 // ttl (30 minutes in milliseconds)
  );

  // Assemble the deploy
  const deploy = DeployUtil.makeDeploy(deployParams, session, payment);

  // Sign the deploy with our agent private key
  const signedDeploy = DeployUtil.signDeploy(deploy, keyPair);

  return await client.putDeploy(signedDeploy);
}

// Visual layout helper for console boxes
function printHeaderBox(title: string): void {
  const width = 60;
  const line = '━'.repeat(width);
  const padding = ' '.repeat(Math.max(0, Math.floor((width - title.length) / 2)));
  console.log(`\n┏${line}┓`);
  console.log(`┃${padding}${title}${padding}${(width - title.length) % 2 !== 0 ? ' ' : ''}┃`);
  console.log(`┗${line}┛`);
}

function printRow(label: string, value: string | number | boolean): void {
  const formattedLabel = label.padEnd(25, ' ');
  console.log(`  ▶ ${formattedLabel} : ${value}`);
}

/**
 * Runs the collaborative multi-agent pipeline programmatically.
 */
export async function runSwarmPipeline(
  customAsset?: Partial<RwaAssetData>,
  clientMemory?: MemoryData
): Promise<PipelineRunResult> {
  if (clientMemory) {
    saveMemory(clientMemory);
  }
  const keyPair = getOrCreateKeyPair();
  
  // 1. Oracle Ingestion
  // customAsset overrides are passed as the second argument so the
  // oracle's deterministic model generates a live-fed baseline and then
  // applies exactly the user-supplied form values on top.
  let oracleData: RwaAssetData;
  try {
    oracleData = await fetchRwaAssetData(customAsset?.assetId, customAsset as Partial<RwaAssetData>);
  } catch (err: any) {
    throw new Error(`Oracle Agent failed: ${err.message}`);
  }
  const oracleResult: PipelineStepResult = {
    step: '1',
    name: 'Oracle Data Ingestion',
    status: 'SUCCESS',
    data: oracleData
  };

  // 2. Compliance Verification
  let complianceData: ComplianceReport;
  try {
    complianceData = validateCompliance(oracleData);
  } catch (err: any) {
    throw new Error(`Compliance Agent failed: ${err.message}`);
  }
  const complianceResult: PipelineStepResult = {
    step: '2',
    name: 'Compliance Verification',
    status: complianceData.compliant ? 'SUCCESS' : 'FAILED',
    data: complianceData
  };

  // 3. Treasury Audit
  let treasuryData: TreasuryReport;
  try {
    treasuryData = await auditTreasury(NODE_RPC_URL, (customAsset as any)?.userAddress);
  } catch (err: any) {
    throw new Error(`Treasury Agent failed: ${err.message}`);
  }
  const treasuryResult: PipelineStepResult = {
    step: '3',
    name: 'Treasury Audit',
    status: 'SUCCESS',
    data: treasuryData
  };

  // 4. Risk Analysis
  let riskData: ClearancePayload;
  try {
    riskData = analyzeRisk(oracleData, complianceData, treasuryData);
  } catch (err: any) {
    throw new Error(`Risk Analyst Agent failed: ${err.message}`);
  }
  const riskResult: PipelineStepResult = {
    step: '4',
    name: 'Risk Analyst Evaluation',
    status: riskData.approved ? 'SUCCESS' : 'FAILED',
    data: riskData
  };

  // ── Generate SHA-256 report fingerprint ────────────────────────────────
  const reportPayload = {
    assetId: oracleData.assetId,
    riskIndex: riskData.riskIndex,
    complianceCompliant: complianceData.compliant,
    agencySignature: complianceData.agencySignature,
    walletBalanceCspr: treasuryData.walletBalanceCspr,
    allocatedCspr: treasuryData.allocatedAmountCspr,
    riskNarrative: riskData.narrative,
    timestamp: Date.now()
  };
  const reportHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(reportPayload))
    .digest('hex');

  // 5. Capital Deployment Execution
  let executionResult: PipelineStepResult;
  let finalMemory: MemoryData;

  // Estimated gas per Casper deploy (payment motes to CSPR)
  const gasUsed = Math.floor(PAYMENT_MOTES / 1_000_000_000);

  // Block height: attempt live RPC query, fall back to deterministic estimate
  let blockHeight = 0;
  try {
    const { CasperServiceByJsonRPC } = await import('casper-js-sdk');
    const rpc = new CasperServiceByJsonRPC(NODE_RPC_URL);
    const blockInfo = await Promise.race([
      rpc.getLatestBlockInfo(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    blockHeight = (blockInfo as any)?.block?.header?.height || 0;
  } catch (_) {
    blockHeight = 0;
  }

  if (!riskData.approved) {
    executionResult = {
      step: '5',
      name: 'Swarm Capital Deployment',
      status: 'FAILED',
      data: { error: 'Aborted due to compliance/risk rejects.', reportHash }
    };
    finalMemory = updateMemory(
      oracleData.assetId,
      false,
      riskData.riskIndex,
      treasuryData.allocatedAmountCspr,
      false,
      undefined,
      {
        reportHash,
        gasUsed,
        blockHeight,
        confirmations: 0,
        credit: oracleData.borrowerCreditScore,
        country: oracleData.countryCode,
        valuation: oracleData.valuation,
        liveDataActive: oracleData.liveDataActive,
        liveCsprPriceUsd: oracleData.liveCsprPriceUsd,
        riskNarrative: riskData.narrative
      }
    );
  } else {
    try {
      const scaledRisk = Math.round(riskData.riskIndex * 1000);
      const deployHash = await executeContractCall(
        oracleData.assetId,
        riskData.amount,
        oracleData.valuation,
        scaledRisk,
        keyPair
      );
      executionResult = {
        step: '5',
        name: 'Swarm Capital Deployment',
        status: 'SUCCESS',
        data: { deployHash, reportHash, gasUsed, blockHeight, confirmations: 1 }
      };
      finalMemory = updateMemory(
        oracleData.assetId,
        true,
        riskData.riskIndex,
        treasuryData.allocatedAmountCspr,
        true,
        deployHash,
        {
          reportHash,
          gasUsed,
          blockHeight,
          confirmations: 1,
          credit: oracleData.borrowerCreditScore,
          country: oracleData.countryCode,
          valuation: oracleData.valuation,
          liveDataActive: oracleData.liveDataActive,
          liveCsprPriceUsd: oracleData.liveCsprPriceUsd,
          riskNarrative: riskData.narrative
        }
      );
    } catch (err: any) {
      executionResult = {
        step: '5',
        name: 'Swarm Capital Deployment',
        status: 'FAILED',
        data: { error: err.message, reportHash }
      };
      finalMemory = updateMemory(
        oracleData.assetId,
        true,
        riskData.riskIndex,
        treasuryData.allocatedAmountCspr,
        false,
        undefined,
        {
          reportHash,
          gasUsed,
          blockHeight,
          confirmations: 0,
          credit: oracleData.borrowerCreditScore,
          country: oracleData.countryCode,
          valuation: oracleData.valuation,
          liveDataActive: oracleData.liveDataActive,
          liveCsprPriceUsd: oracleData.liveCsprPriceUsd,
          riskNarrative: riskData.narrative
        }
      );
    }
  }

  return {
    oracle: oracleResult,
    compliance: complianceResult,
    treasury: treasuryResult,
    risk: riskResult,
    execution: executionResult,
    memory: finalMemory,
    reportHash
  };
}

/**
 * Main orchestration CLI entrypoint.
 */
async function main() {
  console.log('======================================================================');
  console.log('            NexusVault Multi-Agent Collaborative System               ');
  console.log('======================================================================');

  // Step 0: Pre-run status
  const memory = loadMemory();

  printHeaderBox('0. MEMORY ENGINE (PRE-RUN STATUS)');
  printRow('Total Swarm Runs', memory.totalRuns);
  printRow('Successful Deployments', memory.successfulDeploys);
  printRow('Current Confidence Score', `${memory.confidenceScore} / 100`);
  printRow('Target Contract Hash', CONTRACT_HASH);

  // Trigger Swarm Pipeline
  const result = await runSwarmPipeline();

  // Print Step 1: Oracle
  printHeaderBox('1. ORACLE AGENT (LIVE DATA INGESTION)');
  const oracleAsset = result.oracle.data as RwaAssetData;
  printRow('Ingested Asset ID', oracleAsset.assetId);
  printRow('Asset Class', oracleAsset.assetType);
  printRow('Valuation (USD)', `$${oracleAsset.valuation.toLocaleString()}`);
  printRow('Down Payment (USD)', `$${oracleAsset.downPayment.toLocaleString()}`);
  printRow('Market Trend factor', oracleAsset.localMarketTrendMultiplier);
  printRow('Interest Rate', `${(oracleAsset.currentInterestRate * 100).toFixed(2)}%`);
  printRow('Country of Origin', oracleAsset.countryCode);
  printRow('Borrower Credit Score', oracleAsset.borrowerCreditScore);
  printRow('Live CSPR Price (USD)', oracleAsset.liveCsprPriceUsd > 0 ? `$${oracleAsset.liveCsprPriceUsd}` : 'N/A (fallback)');
  printRow('Live Feed Active', oracleAsset.liveDataActive ? '✅ YES — CoinGecko live data' : '⚠️  NO  — deterministic fallback');

  // Print Step 2: Compliance
  printHeaderBox('2. COMPLIANCE AGENT (JURISDICTION & SAFETY)');
  const complianceData = result.compliance.data as ComplianceReport;
  printRow('Compliance Status', complianceData.compliant ? 'PASSED ✅' : 'FAILED ❌');
  if (!complianceData.compliant) {
    complianceData.violations.forEach((violation, i) => {
      printRow(`Violation #${i + 1}`, violation);
    });
  } else {
    printRow('Agency Verification Hash', complianceData.agencySignature.substring(0, 45) + '...');
  }

  // Print Step 3: Treasury
  printHeaderBox('3. TREASURY AGENT (BALANCE AUDIT & ALLOCATION)');
  const treasuryData = result.treasury.data as TreasuryReport;
  printRow('Wallet Public Key', treasuryData.walletPublicKey.substring(0, 30) + '...');
  printRow('Live Balance (CSPR)', `${treasuryData.walletBalanceCspr.toLocaleString()} CSPR`);
  printRow('Allocation Size (CSPR)', `${treasuryData.allocatedAmountCspr} CSPR`);
  printRow('Allocation (Motes)', treasuryData.allocatedAmountMotes);
  printRow('Network Fallback Status', treasuryData.isFallback ? 'YES (offline fallback mode)' : 'NO (live blockchain data)');

  // Print Step 4: Risk
  printHeaderBox('4. RISK ANALYST AGENT (COMPOSITE RISK MATCH)');
  const riskData = result.risk.data as ClearancePayload;
  printRow('Calculated Risk Index', riskData.riskIndex);
  printRow('Dynamic Acceptable Risk', riskData.maxAcceptableRisk);
  printRow('Approval Decision', riskData.approved ? 'APPROVED 🟢' : 'REJECTED 🔴');
  if (riskData.approved) {
    printRow('Clearance Payload Token', riskData.signature.substring(0, 50) + '...');
  }

  // Print Step 5: Execution
  printHeaderBox('5. SWARM EXECUTOR (CAPITAL DEPLOYMENT)');
  if (result.execution.status === 'SUCCESS') {
    console.log(`  [Swarm Executor] Deploy successfully broadcasted to Casper Testnet!`);
    printRow('Transaction Hash', result.execution.data.deployHash);
    console.log(`  [Swarm Explorer Link] https://testnet.cspr.live/deploy/${result.execution.data.deployHash}`);
  } else {
    console.log(`  [Swarm Executor] Capital deployment aborted or failed: ${result.execution.data.error || result.execution.data.message}`);
  }
  console.log(`  [Memory Engine] Confidence adjusted to: ${result.memory.confidenceScore} / 100`);

  console.log('======================================================================');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal crash in Swarm Orchestrator:', err);
  });
}
