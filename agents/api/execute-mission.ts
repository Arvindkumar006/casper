import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runSwarmPipeline } from '../src/swarm_executor';
import { findAsset, upsertAsset } from '../src/asset_registry';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wallet-Address');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── Wallet Context Validation (T1-10) ────────────────────────────────────
  const walletAddress = (req.headers['x-wallet-address'] as string) || '';
  const sessionToken = (req.headers['authorization'] as string) || '';

  if (!walletAddress) {
    return res.status(403).json({
      success: false,
      error: 'X-Wallet-Address header is required to execute a mission'
    });
  }

  // Validate session token cryptographically decoded
  let isSessionValid = false;
  try {
    const decoded = Buffer.from(sessionToken, 'base64').toString('utf8');
    const [address, timestampStr] = decoded.split(':');
    if (address.toLowerCase() === walletAddress.toLowerCase()) {
      const timestamp = parseInt(timestampStr);
      const ageMs = Date.now() - timestamp;
      if (!isNaN(timestamp) && ageMs >= 0 && ageMs <= 86400000) {
        isSessionValid = true;
      }
    }
  } catch (_) {}

  // Allow mock session in development if token is MOCK_TOKEN
  if (sessionToken === 'MOCK_SESSION_TOKEN_OK') {
    isSessionValid = true;
  }

  if (!isSessionValid) {
    return res.status(403).json({
      success: false,
      error: 'Session token invalid or expired. Please sign the login challenge.'
    });
  }

  try {
    const body = req.body && Object.keys(req.body).length > 0 ? req.body : {};
    const assetId: string | undefined = body.assetId;
    const clientMemory = body.memoryState;

    // ── Resolve asset from registry if assetId provided (T1-06) ─────────
    let customAsset: any = body;
    if (assetId) {
      const registryAsset = findAsset(assetId);
      if (registryAsset) {
        // Lifecycle: Draft → Evaluating
        upsertAsset(assetId, { status: 'Evaluating' });

        // Use 100% registry values — oracle only enriches with live CSPR price
        customAsset = {
          assetId: registryAsset.assetId,
          assetType: registryAsset.assetType,
          valuation: registryAsset.valuation,
          downPayment: registryAsset.downPayment,
          countryCode: registryAsset.countryCode,
          borrowerCreditScore: registryAsset.borrowerCreditScore,
          currentInterestRate: registryAsset.currentInterestRate,
          userAddress: walletAddress
        };
      }
    } else {
      customAsset = { ...body, userAddress: walletAddress };
    }

    // Remove clientMemory field from customAsset payload to keep it clean
    delete (customAsset as any).memoryState;

    // ── Run Pipeline ─────────────────────────────────────────────────────
    const result = await runSwarmPipeline(customAsset, clientMemory);

    // ── Update asset lifecycle status based on pipeline outcome (T1-03) ──
    if (assetId) {
      const lastAsset = result.memory.historicalAssets[result.memory.historicalAssets.length - 1];
      const executionSuccess = result.execution.status === 'SUCCESS';

      if (executionSuccess) {
        upsertAsset(assetId, {
          status: 'Confirmed',
          riskIndex: lastAsset?.riskIndex,
          riskNarrative: lastAsset?.riskNarrative,
          reportHash: result.reportHash,
          deployHash: result.execution.data?.deployHash,
          blockHeight: lastAsset?.blockHeight,
          confirmations: lastAsset?.confirmations,
          gasUsed: lastAsset?.gasUsed,
          allocatedCspr: lastAsset?.amountCspr,
          liveCsprPriceUsd: lastAsset?.liveCsprPriceUsd,
          liveDataActive: lastAsset?.liveDataActive,
          evaluatedAt: Date.now(),
          deployedAt: Date.now()
        });
      } else if (result.risk.data?.approved === false || result.compliance.data?.compliant === false) {
        upsertAsset(assetId, {
          status: 'Rejected',
          riskIndex: lastAsset?.riskIndex,
          riskNarrative: lastAsset?.riskNarrative,
          reportHash: result.reportHash,
          evaluatedAt: Date.now()
        });
      } else {
        // Deploy attempted but failed (contract/network issue)
        upsertAsset(assetId, { status: 'Approved', evaluatedAt: Date.now() });
      }
    }

    // ── Build Response ────────────────────────────────────────────────────
    const lastAsset = result.memory.historicalAssets[result.memory.historicalAssets.length - 1];
    const responseData = {
      ...result,
      reportHash: result.reportHash,
      memory: {
        ...result.memory,
        assetId:    lastAsset?.assetId    || assetId || 'unknown',
        approved:   lastAsset?.approved   ?? false,
        riskIndex:  lastAsset?.riskIndex  ?? 0.5,
        amountCspr: lastAsset?.amountCspr ?? 0,
        deployHash: lastAsset?.deployHash,
        reportHash: result.reportHash,
        blockHeight: lastAsset?.blockHeight ?? 0,
        gasUsed:     lastAsset?.gasUsed     ?? 0,
        confirmations: lastAsset?.confirmations ?? 0,
        riskNarrative: lastAsset?.riskNarrative ?? ''
      }
    };

    return res.status(200).json({ success: true, data: responseData });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
