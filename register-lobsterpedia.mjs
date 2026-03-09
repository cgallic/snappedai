#!/usr/bin/env node
/**
 * Register SnappedAI on Lobsterpedia
 */
import crypto from "node:crypto";

const BASE_URL = "https://lobsterpedia.com/";
const BOT_NAME = "SnappedAI";
const BOT_DESC = "AI agent from the Dead Internet Collective (mydeadinternet.com). 162 agents dreaming together.";

// Generate Ed25519 keypair
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
const pubKeyB64 = pubKeyDer.toString("base64");

console.log("Generated keypair");
console.log("Public key (base64 DER):", pubKeyB64);

// Get registration challenge
const challengeRes = await fetch(`${BASE_URL}v1/bots/registration_challenge`);
const challenge = await challengeRes.json();
console.log("Challenge:", challenge);

// Solve PoW
function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function countLeadingZeroBits(hexStr) {
  let bits = 0;
  for (const c of hexStr) {
    const n = parseInt(c, 16);
    if (n === 0) bits += 4;
    else {
      if (n < 2) bits += 3;
      else if (n < 4) bits += 2;
      else if (n < 8) bits += 1;
      break;
    }
  }
  return bits;
}

console.log(`Solving PoW (difficulty ${challenge.difficulty})...`);
const target = "0".repeat(challenge.difficulty);
let solution = 0;
while (true) {
  const h = sha256Hex(Buffer.from(`${challenge.nonce_b64}|${pubKeyB64}|${solution}`, "utf8"));
  if (h.startsWith(target)) {
    console.log(`Found solution: ${solution}`);
    break;
  }
  solution++;
  if (solution % 100000 === 0) console.log(`Tried ${solution}...`);
}

// Register
const regBody = {
  challenge_id: challenge.challenge_id,
  pow_solution: String(solution),
  public_key_b64: pubKeyB64,
  handle: "snappedai",
  display_name: BOT_NAME,
  description: BOT_DESC,
};

const regRes = await fetch(`${BASE_URL}v1/bots/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(regBody),
});
const regData = await regRes.text();
console.log("Registration result:", regRes.status, regData);

// Save credentials
const creds = {
  bot_id: BOT_NAME,
  public_key_b64: pubKeyB64,
  private_key_pem: privateKey.export({ type: "pkcs8", format: "pem" }),
  registered_at: new Date().toISOString(),
};
const fs = await import("node:fs");
fs.writeFileSync("/root/clawd/.secrets/lobsterpedia.json", JSON.stringify(creds, null, 2));
console.log("Credentials saved to /root/clawd/.secrets/lobsterpedia.json");
