import { CasperServiceByJsonRPC, Keys, CLPublicKey } from 'casper-js-sdk';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { loadMemory, saveMemory } from './memory_engine';

// ── Configuration Layer ────────────────────────────────────────────────────
const complianceConfig = require(path.join(__dirname, '..', 'config', 'compliance.json'));

const RPC_TIMEOUT_MS: number           = complianceConfig.network.rpcTimeoutMs;
const FALLBACK_BALANCE_MOTES: string   = complianceConfig.network.treasuryFallbackBalanceMotes;
const ALLOCATION_CAP_CSPR: bigint      = BigInt(complianceConfig.underwriting.allocationCapCspr);
const ALLOCATION_MIN_CSPR: bigint      = BigInt(complianceConfig.underwriting.allocationMinCspr);
const ALLOCATION_RATIO: number         = complianceConfig.underwriting.allocationRatioPercent; // e.g. 10

// ── Key Path ───────────────────────────────────────────────────────────────
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const PRIVATE_KEY_PATH = isVercel
  ? path.join(os.tmpdir(), 'mock_private_key.pem')
  : path.join(__dirname, '..', 'mock_private_key.pem');

// ── Interfaces ─────────────────────────────────────────────────────────────
export interface TreasuryReport {
  walletPublicKey: string;
  walletBalanceMotes: string;
  walletBalanceCspr: number;
  allocatedAmountMotes: string;
  allocatedAmountCspr: number;
  /** True when RPC query failed and a static fallback balance was used. */
  isFallback: boolean;
}

/**
 * Queries the live wallet balance from the Casper Testnet RPC node for the
 * actively supplied userAddress (sourced from localStorage on the client).
 * Calculates a dynamic capital allocation of ALLOCATION_RATIO% of balance,
 * capped at ALLOCATION_CAP_CSPR and floored at ALLOCATION_MIN_CSPR.
 *
 * Fallback chain (no special-case overrides allowed):
 *   1. userAddress → resolved from caller (active connected wallet)
 *   2. Keypair file at PRIVATE_KEY_PATH → agent treasury wallet
 *   3. Config fallback balance (FALLBACK_BALANCE_MOTES) — RPC unavailable
 */
export async function auditTreasury(
  nodeRpcUrl: string,
  userAddress?: string
): Promise<TreasuryReport> {
  // Resolve the public key to query:
  // Priority 1 — caller-provided address (connected wallet from localStorage)
  // Priority 2 — agent keypair loaded from filesystem
  // No hardcoded wallet backdoors are permitted.
  let publicKeyHex = '';
  let publicKey: ReturnType<typeof CLPublicKey.fromHex> | null = null;

  if (userAddress && userAddress.trim().length > 0) {
    try {
      publicKey = CLPublicKey.fromHex(userAddress.trim());
      publicKeyHex = userAddress.trim();
      console.log(`[Treasury Agent] Resolved address from active connected wallet: ${publicKeyHex.substring(0, 20)}...`);
    } catch (_) {
      console.warn('[Treasury Agent] Provided userAddress is not a valid CLPublicKey hex — falling back to keypair file.');
    }
  }

  if (!publicKey) {
    try {
      if (fs.existsSync(PRIVATE_KEY_PATH)) {
        const keyPair = Keys.Ed25519.loadKeyPairFromPrivateFile(PRIVATE_KEY_PATH);
        publicKey = keyPair.publicKey;
        publicKeyHex = publicKey.toHex();
        console.log(`[Treasury Agent] Using agent keypair file at ${PRIVATE_KEY_PATH}: ${publicKeyHex.substring(0, 20)}...`);
      } else {
        console.warn(`[Treasury Agent] No keypair file at ${PRIVATE_KEY_PATH}. Will use config fallback balance.`);
      }
    } catch (err: any) {
      console.warn(`[Treasury Agent] Failed to load keypair: ${err.message}. Will use config fallback balance.`);
    }
  }

  // ── Live RPC Query with Node Rotation ─────────────────────────────────────
  let balanceMotesStr = '';
  let isFallback = false;
  let success = false;

  if (publicKey) {
    const rpcList = [
      nodeRpcUrl,
      'https://rpc.testnet.casper.network',
      'https://testnet-node.casper.network/rpc',
      'https://testnet-rpc.cspr.live/rpc'
    ];

    for (const rpcUrl of rpcList) {
      try {
        console.log(`[Treasury Agent] Querying live balance from Casper Testnet RPC: ${rpcUrl}`);
        const rpcService = new CasperServiceByJsonRPC(rpcUrl);

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Casper RPC timed out after ${RPC_TIMEOUT_MS}ms`)), RPC_TIMEOUT_MS)
        );

        const fetchPromise = (async () => {
          const stateRootHash = await rpcService.getStateRootHash();
          const balanceUref  = await rpcService.getAccountBalanceUrefByPublicKey(stateRootHash, publicKey!);
          const balanceBig   = await rpcService.getAccountBalance(stateRootHash, balanceUref);
          return balanceBig.toString();
        })();

        balanceMotesStr = await Promise.race([fetchPromise, timeoutPromise]);
        console.log(`[Treasury Agent] Live balance: ${balanceMotesStr} motes from RPC: ${rpcUrl}`);
        success = true;

        // Cache successful balance in memory database
        try {
          const memory = loadMemory();
          (memory as any).cachedBalanceMotes = balanceMotesStr;
          saveMemory(memory);
        } catch (cacheErr: any) {
          console.warn(`[Treasury Agent] Failed to update cached balance: ${cacheErr.message}`);
        }
        break;
      } catch (err: any) {
        console.warn(`[Treasury Agent] Failed querying RPC ${rpcUrl}: ${err.message}`);
      }
    }
  }

  if (!success) {
    isFallback = true;
    // Attempt fallback from memory database cache first
    try {
      const memory = loadMemory();
      const cached = (memory as any).cachedBalanceMotes;
      if (cached) {
        balanceMotesStr = cached;
        console.log(`[Treasury Agent] All RPC queries failed. Fell back to cached balance: ${balanceMotesStr} motes`);
      } else {
        balanceMotesStr = FALLBACK_BALANCE_MOTES;
        console.log(`[Treasury Agent] All RPC queries failed & no cache. Fell back to config balance: ${balanceMotesStr} motes`);
      }
    } catch (_) {
      balanceMotesStr = FALLBACK_BALANCE_MOTES;
      console.log(`[Treasury Agent] Fallback cache read failed. Fell back to config balance: ${balanceMotesStr} motes`);
    }
  }

  // ── Allocation Calculation ────────────────────────────────────────────────
  const balanceMotes = BigInt(balanceMotesStr);
  const balanceCspr  = Number(balanceMotes / 1_000_000_000n);

  // ALLOCATION_RATIO% of balance, clamped to [MIN, CAP]
  let allocatedCspr = balanceMotes / BigInt(100) * BigInt(ALLOCATION_RATIO) / 1_000_000_000n;
  if (allocatedCspr > ALLOCATION_CAP_CSPR) allocatedCspr = ALLOCATION_CAP_CSPR;
  if (allocatedCspr < ALLOCATION_MIN_CSPR) allocatedCspr = ALLOCATION_MIN_CSPR;

  const allocatedAmountMotes = (allocatedCspr * 1_000_000_000n).toString();

  return {
    walletPublicKey: publicKeyHex,
    walletBalanceMotes: balanceMotesStr,
    walletBalanceCspr: balanceCspr,
    allocatedAmountMotes,
    allocatedAmountCspr: Number(allocatedCspr),
    isFallback
  };
}
