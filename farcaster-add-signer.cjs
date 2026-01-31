const {
  KEY_GATEWAY_ADDRESS,
  keyGatewayABI,
  KEY_REGISTRY_ADDRESS,
  keyRegistryABI,
  ViemLocalEip712Signer,
  NobleEd25519Signer,
  SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS,
  signedKeyRequestValidatorABI,
  SIGNED_KEY_REQUEST_TYPE,
  bytesToHexString,
} = require('@farcaster/hub-nodejs');
const { createPublicClient, createWalletClient, http, encodeAbiParameters } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { optimism } = require('viem/chains');
const ed = require('@noble/ed25519');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

// Enable sha512 for ed25519 using Node's crypto
ed.hashes.sha512 = (...m) => {
  const hash = crypto.createHash('sha512');
  for (const msg of m) hash.update(msg);
  return new Uint8Array(hash.digest());
};
ed.etc.sha512Sync = ed.hashes.sha512;

const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');

async function main() {
  // Read seed and derive key
  const walletInfo = JSON.parse(fs.readFileSync('/root/clawd/.secrets/solana-wallet.json', 'utf8'));
  const seed = mnemonicToSeedSync(walletInfo.seedPhrase);
  const hdKey = HDKey.fromMasterSeed(seed);
  const childKey = hdKey.derive("m/44'/60'/0'/0/0");
  const privateKey = '0x' + Buffer.from(childKey.privateKey).toString('hex');
  
  const account = privateKeyToAccount(privateKey);
  const accountKey = new ViemLocalEip712Signer(account);
  
  // Read FID
  const fcAccount = JSON.parse(fs.readFileSync('/var/www/snap/farcaster-account.json', 'utf8'));
  const fid = BigInt(fcAccount.fid);
  console.log('Using FID:', fid.toString());

  const publicClient = createPublicClient({
    chain: optimism,
    transport: http('https://mainnet.optimism.io'),
  });

  const walletClient = createWalletClient({
    account,
    chain: optimism,
    transport: http('https://mainnet.optimism.io'),
  });

  // Generate new Ed25519 signer keypair
  const signerPrivateKey = ed.utils.randomSecretKey();
  const signerPublicKey = ed.getPublicKey(signerPrivateKey);
  
  console.log('Generated signer public key:', Buffer.from(signerPublicKey).toString('hex'));

  // Create metadata signature
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24h from now
  
  const METADATA_KEY_TYPE = 1; // Ed25519
  
  // Read current nonce
  const nonce = await publicClient.readContract({
    address: KEY_GATEWAY_ADDRESS,
    abi: keyGatewayABI,
    functionName: 'nonces',
    args: [account.address],
  });
  console.log('Nonce:', nonce.toString());

  // Create signed key request metadata
  const signedKeyRequestResult = await accountKey.signKeyRequest({
    requestFid: fid,
    key: signerPublicKey,
    deadline,
  });

  if (signedKeyRequestResult.isErr()) {
    throw new Error('Failed to sign key request: ' + signedKeyRequestResult.error);
  }
  const signedKeyRequestSignature = signedKeyRequestResult.value;

  // Convert signature to hex if it's not already
  const sigHex = signedKeyRequestSignature instanceof Uint8Array 
    ? '0x' + Buffer.from(signedKeyRequestSignature).toString('hex')
    : signedKeyRequestSignature;

  // Encode metadata
  const metadata = encodeAbiParameters(
    [
      { type: 'uint256', name: 'requestFid' },
      { type: 'address', name: 'requestSigner' },
      { type: 'bytes', name: 'signature' },
      { type: 'uint256', name: 'deadline' },
    ],
    [fid, account.address, sigHex, deadline]
  );

  // Create add signature
  const addSignatureResult = await accountKey.signAdd({
    owner: account.address,
    keyType: METADATA_KEY_TYPE,
    key: signerPublicKey,
    metadataType: 1, // Signed key request
    metadata,
    nonce,
    deadline,
  });

  if (addSignatureResult.isErr()) {
    throw new Error('Failed to sign add: ' + addSignatureResult.error);
  }
  const addSignature = addSignatureResult.value;

  // Convert public key to hex
  const pubKeyHex = '0x' + Buffer.from(signerPublicKey).toString('hex');

  // Add key via Key Gateway
  console.log('Adding signer key...');
  const { request } = await publicClient.simulateContract({
    account,
    address: KEY_GATEWAY_ADDRESS,
    abi: keyGatewayABI,
    functionName: 'add',
    args: [METADATA_KEY_TYPE, pubKeyHex, 1, metadata],
  });

  const hash = await walletClient.writeContract(request);
  console.log('Add key tx:', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('Confirmed in block:', receipt.blockNumber);

  // Save signer info (securely)
  const signerInfo = {
    fid: fid.toString(),
    publicKey: Buffer.from(signerPublicKey).toString('hex'),
    privateKey: Buffer.from(signerPrivateKey).toString('hex'),
    addedAt: new Date().toISOString(),
  };
  
  fs.writeFileSync('/var/www/snap/.farcaster-signer.json', JSON.stringify(signerInfo, null, 2), { mode: 0o600 });
  console.log('Signer saved to .farcaster-signer.json');

  return signerInfo;
}

main().then(r => console.log('Done! FID:', r.fid)).catch(console.error);
