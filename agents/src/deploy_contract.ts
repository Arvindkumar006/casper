import * as fs from 'fs';
import * as path from 'path';
import {
  CasperClient,
  DeployUtil,
  RuntimeArgs,
  CLValueBuilder,
  CLAccountHash,
  Keys
} from 'casper-js-sdk';

// Paths to files
const PRIVATE_KEY_PATH = path.join(__dirname, '..', 'mock_private_key.pem');
const WASM_PATH = path.join(__dirname, '..', '..', 'contracts', '.cargo_target_temp', 'wasm32-unknown-unknown', 'release', 'nexus_vault_build_contract.wasm');

// Fallback in case standard output path is used
const WASM_FALLBACK_PATH = path.join(__dirname, '..', '..', 'contracts', 'target', 'wasm32-unknown-unknown', 'release', 'nexus_vault_build_contract.wasm');

/**
 * Loads the existing mock keypair.
 */
function loadKeyPair(): Keys.AsymmetricKey {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    throw new Error(`Agent private key not found at ${PRIVATE_KEY_PATH}. Run swarm_executor first to generate keypair.`);
  }
  console.log(`Loading agent key pair from ${PRIVATE_KEY_PATH}...`);
  return Keys.Ed25519.loadKeyPairFromPrivateFile(PRIVATE_KEY_PATH);
}

/**
 * Deploys the compiled smart contract to Casper Testnet.
 */
async function deployContract() {
  console.log('==================================================');
  console.log('         DEPLOYING NEXUS VAULT SMART CONTRACT     ');
  console.log('==================================================');

  // 1. Get contract WASM binary bytes
  let wasmPath = WASM_PATH;
  if (!fs.existsSync(wasmPath)) {
    wasmPath = WASM_FALLBACK_PATH;
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`Contract WASM binary not found at ${WASM_PATH} or ${WASM_FALLBACK_PATH}. Make sure to build the contract first.`);
    }
  }
  console.log(`Reading contract binary from ${wasmPath}...`);
  const wasmBytes = new Uint8Array(fs.readFileSync(wasmPath));

  // 2. Load signing keys
  const keyPair = loadKeyPair();
  const publicKey = keyPair.publicKey;
  const accountHashBytes = publicKey.toAccountHash();

  console.log(`Agent Public Key: ${publicKey.toHex()}`);
  console.log(`Setting agent_swarm_key to: ${publicKey.toHex()}`);

  // 3. Construct initialization arguments for the constructor/init function of Odra
  //
  // The Odra-generated `call()` WASM entry point reads four internal config args before
  // doing anything else. These must be included in every Odra contract deployment:
  //
  //   odra_cfg_is_upgrade             – false for fresh install (true for upgrade)
  //   odra_cfg_package_hash_key_name  – the named key under which the contract
  //                                     package hash is stored in the account's
  //                                     named keys. Must be unique per contract.
  //   odra_cfg_allow_key_override     – whether to overwrite an existing key with
  //                                     the same name (set false for safety)
  //   odra_cfg_is_upgradable          – whether the contract package should be
  //                                     created as an upgradable (unlocked) package
  //
  // Followed by the user-defined init() arguments:
  //   agent_swarm_key                 – Address of the authorised swarm agent
  const CONTRACT_PACKAGE_KEY_NAME = 'NexusVault';
  const args = RuntimeArgs.fromMap({
    // --- Odra framework config args (required by every Odra Casper contract) ---
    odra_cfg_is_upgrade:            CLValueBuilder.bool(false),
    odra_cfg_package_hash_key_name: CLValueBuilder.string(CONTRACT_PACKAGE_KEY_NAME),
    odra_cfg_allow_key_override:    CLValueBuilder.bool(false),
    odra_cfg_is_upgradable:         CLValueBuilder.bool(false),
    // --- NexusVault init() arguments ---
    agent_swarm_key: CLValueBuilder.key(new CLAccountHash(accountHashBytes)),
  });

  // 4. Construct ExecutableDeployItem (Module Bytes)
  const session = DeployUtil.ExecutableDeployItem.newModuleBytes(wasmBytes, args);

  // 5. Define standard payment for contract installation (typically 500 CSPR on testnet)
  const INSTALL_PAYMENT_MOTES = 500_000_000_000; // 500 CSPR
  const payment = DeployUtil.standardPayment(INSTALL_PAYMENT_MOTES);

  // 6. Define Deploy parameters
  const deployParams = new DeployUtil.DeployParams(
    publicKey,
    'casper-test',
    1, // gasPrice
    1800000 // ttl (30 minutes in milliseconds)
  );

  // 7. Assemble the deploy
  const deploy = DeployUtil.makeDeploy(deployParams, session, payment);

  // 8. Sign the deploy
  const signedDeploy = DeployUtil.signDeploy(deploy, keyPair);

  console.log('Deployment deploy payload constructed and signed successfully.');
  console.log('Transaction Deploy Hash:', signedDeploy.hash.toString());

  // 9. Broadcast deploy to RPC node
  const NODE_RPC_URL = 'https://node.testnet.casper.network/rpc';
  const client = new CasperClient(NODE_RPC_URL);

  try {
    const deployHash = await client.putDeploy(signedDeploy);
    console.log(`Deployment successfully broadcast to Casper Testnet!`);
    console.log(`Deploy Hash: ${deployHash}`);
    console.log(`You can check deploy status on: https://testnet.cspr.live/deploy/${deployHash}`);
    console.log(`Once the deploy is processed, copy the resulting Contract Hash and update swarm_executor.ts`);
    return deployHash;
  } catch (err: any) {
    console.error('Failed to broadcast contract deployment deploy:', err.message);
    throw err;
  }
}

deployContract()
  .then(() => {
    console.log('Deployment helper finished.');
  })
  .catch((err) => {
    console.error('Deployment helper failed:', err);
  });
