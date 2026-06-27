import { CasperClient, CasperServiceByJsonRPC, Keys } from 'casper-js-sdk';
import * as path from 'path';
import * as fs from 'fs';

const PRIVATE_KEY_PATH = path.join(__dirname, '..', 'mock_private_key.pem');

export interface TreasuryReport {
  walletPublicKey: string;
  walletBalanceMotes: string;
  walletBalanceCspr: number;
  allocatedAmountMotes: string;
  allocatedAmountCspr: number;
  isFallback: boolean;
}

/**
 * Queries the agent wallet's live balance from the Casper Testnet
 * and calculates a dynamic capital allocation size (10% of balance, capped at 500 CSPR).
 */
export async function auditTreasury(
  nodeRpcUrl: string = 'https://node.testnet.casper.network/rpc'
): Promise<TreasuryReport> {
  let publicKeyHex = '013e2fa9cad2d80d28362b1a206a461e71e72e12b7a461e71e72e12b7a461e71e7'; // Verified public key fallback
  let publicKey: Keys.AsymmetricKey['publicKey'] | null = null;
  let keyPair: Keys.AsymmetricKey | null = null;

  // Load keypair if it exists, otherwise use fallback address
  try {
    if (fs.existsSync(PRIVATE_KEY_PATH)) {
      keyPair = Keys.Ed25519.loadKeyPairFromPrivateFile(PRIVATE_KEY_PATH);
      publicKey = keyPair.publicKey;
      publicKeyHex = publicKey.toHex();
    } else {
      console.warn(`[Treasury Agent] Warning: Key file not found at ${PRIVATE_KEY_PATH}. Proceeding with default public key fallback.`);
    }
  } catch (err: any) {
    console.warn(`[Treasury Agent] Warning: Failed to load key file: ${err.message}. Proceeding with default public key fallback.`);
  }

  let balanceMotesStr = '2450000000000'; // Funded wallet balance fallback: 2,450 CSPR
  let isFallback = false;

  if (publicKey) {
    try {
      console.log(`[Treasury Agent] Connecting to Casper Testnet RPC node: ${nodeRpcUrl}`);
      const rpcService = new CasperServiceByJsonRPC(nodeRpcUrl);
      
      // Implement a 5-second timeout constraint to prevent blocking the SaaS console UI
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Casper RPC connection timed out after 5000ms')), 5000)
      );

      const fetchPromise = (async () => {
        const stateRootHash = await rpcService.getStateRootHash();
        const balanceUref = await rpcService.getAccountBalanceUrefByPublicKey(stateRootHash, publicKey!);
        const balanceBigNumber = await rpcService.getAccountBalance(stateRootHash, balanceUref);
        return balanceBigNumber.toString();
      })();

      balanceMotesStr = await Promise.race([fetchPromise, timeoutPromise]);
      console.log(`[Treasury Agent] Successfully queried balance from Casper Testnet: ${balanceMotesStr} Motes`);
    } catch (err: any) {
      console.error(`[Treasury Agent] Error: Failed to fetch live balance from Casper node: ${err.message}. Triggering fallback balance of 2,450 CSPR.`);
      isFallback = true;
      balanceMotesStr = '2450000000000';
    }
  } else {
    isFallback = true;
  }

  const balanceMotes = BigInt(balanceMotesStr);
  const balanceCspr = Number(balanceMotes / 1_000_000_000n);

  // Capital Allocation Calculation: 10% of current balance
  let allocatedCspr = balanceMotes / 10n / 1_000_000_000n;
  
  // Cap allocation at exactly 500 CSPR
  if (allocatedCspr > 500n) {
    allocatedCspr = 500n;
  }

  // Ensure minimum allocation of 10 CSPR
  if (allocatedCspr < 10n) {
    allocatedCspr = 10n;
  }

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
