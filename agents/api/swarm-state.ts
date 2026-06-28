import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CasperServiceByJsonRPC, CLPublicKey } from 'casper-js-sdk';
import { loadMemory, saveMemory } from '../src/memory_engine';
import { loadAssets } from '../src/asset_registry';
import * as path from 'path';

const complianceConfig = require(path.join(process.cwd(), 'config', 'compliance.json'));
const NODE_RPC_URL: string = complianceConfig.network.nodeRpcUrl;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wallet-Address');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const memory = loadMemory();
  const assets = loadAssets();

  // ── Wallet context: prefer X-Wallet-Address header, fall back to query param ──
  const walletAddress = (
    (req.headers['x-wallet-address'] as string) ||
    (req.query.address as string) ||
    ''
  ).trim();

  // ── Live RPC Balance Query ────────────────────────────────────────────────
  let balanceCspr = 0;
  let rpcOnline = false;

  if (walletAddress) {
    try {
      const clPubKey = CLPublicKey.fromHex(walletAddress);
      const rpcService = new CasperServiceByJsonRPC(NODE_RPC_URL);

      const fetchPromise = (async () => {
        const stateRootHash = await rpcService.getStateRootHash();
        try {
          const balanceUref = await rpcService.getAccountBalanceUrefByPublicKey(stateRootHash, clPubKey);
          const balanceBigNumber = await rpcService.getAccountBalance(stateRootHash, balanceUref);
          return Number(BigInt(balanceBigNumber.toString()) / 1_000_000_000n);
        } catch (_) {
          return 0;
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('RPC timeout')), complianceConfig.network.rpcTimeoutMs)
      );

      balanceCspr = await Promise.race([fetchPromise, timeoutPromise]);
      rpcOnline = true;
    } catch (err: any) {
      console.warn(`[swarm-state] Live RPC balance query failed: ${err.message}`);
      rpcOnline = false;
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      // System state
      totalRuns: memory.totalRuns,
      successfulDeploys: memory.successfulDeploys,
      confidenceScore: memory.confidenceScore,
      historicalAssets: memory.historicalAssets,
      // Asset registry
      totalAssets: assets.length,
      draftAssets: assets.filter(a => a.status === 'Draft').length,
      approvedAssets: assets.filter(a => a.status === 'Confirmed').length,
      rejectedAssets: assets.filter(a => a.status === 'Rejected').length,
      // Wallet context
      walletAddress,
      balanceCspr,
      rpcOnline
    }
  });
}
