import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { loadMemory, saveMemory } from './memory_engine';
import { runSwarmPipeline } from './swarm_executor';
import { auditTreasury } from './treasury_agent';
import { CasperServiceByJsonRPC, CLPublicKey } from 'casper-js-sdk';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fetch historical database and wallet balance
app.get(['/api/history', '/api/swarm-state'], async (req, res) => {
  try {
    const memory = loadMemory();
    
    // Also fetch live treasury details to display current balance
    let balanceCspr = 2924;
    let walletAddress = (req.query.address as string) || '013e2fa9cad2d80d28362b1a206a461e71e72e12b7a461e71e72e12b7a461e71e7';

    try {
      if (req.query.address) {
        const NODE_RPC_URL = 'https://node.testnet.casper.network/rpc';
        const rpcService = new CasperServiceByJsonRPC(NODE_RPC_URL);
        const clPubKey = CLPublicKey.fromHex(walletAddress);
        const stateRootHash = await rpcService.getStateRootHash();
        try {
          const balanceUref = await rpcService.getAccountBalanceUrefByPublicKey(stateRootHash, clPubKey);
          const balanceBigNumber = await rpcService.getAccountBalance(stateRootHash, balanceUref);
          const balanceMotes = BigInt(balanceBigNumber.toString());
          balanceCspr = Number(balanceMotes / 1_000_000_000n);
        } catch (_) {
          balanceCspr = 0;
        }
      } else {
        const treasury = await auditTreasury('https://node.testnet.casper.network/rpc');
        balanceCspr = treasury.walletBalanceCspr;
        walletAddress = treasury.walletPublicKey;
      }
    } catch (err: any) {
      console.warn(`[Server] Failed to fetch wallet balance: ${err.message}`);
      balanceCspr = 0;
    }

    res.json({
      success: true,
      data: {
        ...memory,
        walletAddress,
        balanceCspr
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Post endpoint for manually adding/modeling asset
app.post('/api/swarm-state', async (req, res) => {
  try {
    const memory = loadMemory();
    const { assetId, valuation, downPayment } = req.body;
    if (!assetId) {
      return res.status(400).json({ success: false, error: 'Missing assetId parameter' });
    }

    const newAsset = {
      assetId,
      timestamp: Date.now(),
      approved: false,
      riskIndex: 0.5,
      amountCspr: Math.round((valuation - (downPayment || 0)) / 10),
    };

    memory.historicalAssets.push(newAsset);
    memory.totalRuns += 1;
    saveMemory(memory);

    res.json({
      success: true,
      data: memory
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run active multi-agent pipeline
app.post(['/api/run', '/api/execute-mission'], async (req, res) => {
  try {
    console.log('[Server] Swarm execution triggered via web console.');
    const customAsset = req.body && Object.keys(req.body).length > 0 ? req.body : undefined;
    const result = await runSwarmPipeline(customAsset);
    res.json({
      success: true,
      data: result
    });
  } catch (err: any) {
    console.error(`[Server] Swarm run failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to index.html for spa
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  NexusVault Console Dashboard running at:         `);
  console.log(`  👉 http://localhost:${PORT}                      `);
  console.log(`==================================================`);
});
