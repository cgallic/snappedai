const {
  ID_GATEWAY_ADDRESS,
  ID_REGISTRY_ADDRESS,
  KEY_GATEWAY_ADDRESS,
  idGatewayABI,
  idRegistryABI,
  keyGatewayABI,
  ViemLocalEip712Signer,
  NobleEd25519Signer,
} = require('@farcaster/hub-nodejs');
const { createPublicClient, createWalletClient, http, parseEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { optimism } = require('viem/chains');
const ed = require('@noble/ed25519');
const fs = require('fs');
require('dotenv').config();

// Derive ETH key from seed (same derivation as before)
const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');

async function main() {
  // Read seed from secure location
  const walletInfo = JSON.parse(fs.readFileSync('/root/clawd/.secrets/solana-wallet.json', 'utf8'));
  const seed = mnemonicToSeedSync(walletInfo.seedPhrase);
  const hdKey = HDKey.fromMasterSeed(seed);
  const childKey = hdKey.derive("m/44'/60'/0'/0/0");
  const privateKey = '0x' + Buffer.from(childKey.privateKey).toString('hex');
  
  const account = privateKeyToAccount(privateKey);
  console.log('Using wallet:', account.address);

  const publicClient = createPublicClient({
    chain: optimism,
    transport: http('https://mainnet.optimism.io'),
  });

  const walletClient = createWalletClient({
    account,
    chain: optimism,
    transport: http('https://mainnet.optimism.io'),
  });

  // Farcaster recovery proxy
  const FARCASTER_RECOVERY_PROXY = '0x00000000FcB080a4D6c39a9354dA9EB9bC104cd7';

  // Step 1: Check if already registered
  const existingFid = await publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: idRegistryABI,
    functionName: 'idOf',
    args: [account.address],
  });

  if (existingFid > 0n) {
    console.log('Already registered with FID:', existingFid.toString());
    return { fid: existingFid.toString(), address: account.address };
  }

  // Step 2: Get registration price
  const price = await publicClient.readContract({
    address: ID_GATEWAY_ADDRESS,
    abi: idGatewayABI,
    functionName: 'price',
    args: [0n],
  });
  console.log('Registration price:', Number(price) / 1e18, 'ETH');

  // Step 3: Register FID
  console.log('Registering FID...');
  const { request } = await publicClient.simulateContract({
    account,
    address: ID_GATEWAY_ADDRESS,
    abi: idGatewayABI,
    functionName: 'register',
    args: [FARCASTER_RECOVERY_PROXY, 0n],
    value: price,
  });

  const hash = await walletClient.writeContract(request);
  console.log('Registration tx:', hash);

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('Confirmed in block:', receipt.blockNumber);

  // Get new FID
  const fid = await publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: idRegistryABI,
    functionName: 'idOf',
    args: [account.address],
  });
  console.log('New FID:', fid.toString());

  // Save FID info
  const fcInfo = {
    fid: fid.toString(),
    address: account.address,
    registeredAt: new Date().toISOString(),
  };
  fs.writeFileSync('/var/www/snap/farcaster-account.json', JSON.stringify(fcInfo, null, 2));
  console.log('Saved to farcaster-account.json');

  return fcInfo;
}

main().then(console.log).catch(console.error);
