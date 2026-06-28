import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CasperServiceByJsonRPC, CLPublicKey } from 'casper-js-sdk';

const DEFAULT_MEMORY = {
  totalRuns: 12,
  successfulDeploys: 3,
  confidenceScore: 75,
  historicalAssets: [
    {
      assetId: 'rwa_solar_001',
      timestamp: Date.now() - 86400000 * 2,
      approved: true,
      riskIndex: 0.31,
      amountCspr: 292,
      deployHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    },
    {
      assetId: 'rwa_nyc_tower_002',
      timestamp: Date.now() - 86400000,
      approved: true,
      riskIndex: 0.42,
      amountCspr: 292,
      deployHash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3'
    },
    {
      assetId: 'rwa_agri_003',
      timestamp: Date.now() - 3600000 * 5,
      approved: false,
      riskIndex: 0.81,
      amountCspr: 0
    },
    {
      assetId: 'rwa_bond_004',
      timestamp: Date.now() - 3600000,
      approved: true,
      riskIndex: 0.27,
      amountCspr: 292,
      deployHash: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
    }
  ]
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let balanceCspr = 2924;
    let walletAddress = (req.query.address as string) || '013e2fa9cad2d80d28362b1a206a461e71e72e12b7a461e71e72e12b7a461e71e7';

    try {
      const NODE_RPC_URL = 'https://node.testnet.casper.network/rpc';
      const rpcService = new CasperServiceByJsonRPC(NODE_RPC_URL);
      const clPubKey = CLPublicKey.fromHex(walletAddress);

      const fetchPromise = (async () => {
        const stateRootHash = await rpcService.getStateRootHash();
        try {
          const balanceUref = await rpcService.getAccountBalanceUrefByPublicKey(stateRootHash, clPubKey);
          const balanceBigNumber = await rpcService.getAccountBalance(stateRootHash, balanceUref);
          const balanceMotes = BigInt(balanceBigNumber.toString());
          return Number(balanceMotes / 1_000_000_000n);
        } catch (_) {
          return 0;
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('RPC timeout')), 4000)
      );

      const fetchedBalance = await Promise.race([fetchPromise, timeoutPromise]);
      if (typeof fetchedBalance === 'number') {
        balanceCspr = fetchedBalance;
      }
    } catch (err: any) {
      console.warn(`[Vercel Serverless] Failed to query live balance: ${err.message}`);
      balanceCspr = 0;
    }

    return res.status(200).json({
      success: true,
      data: {
        ...DEFAULT_MEMORY,
        walletAddress,
        balanceCspr
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
