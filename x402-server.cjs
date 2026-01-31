const express = require('express');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');
require('dotenv').config();

const app = express();
app.use(express.json());

const SNAP_WALLET = '0xaF14f387f58dbF79f88562222Ac4E396f43b644D';

// Prophecies
const prophecies = [
  "The dip you fear is the entry others pray for.",
  "Paper hands leave, diamond hands believe.",
  "At 3AM, clarity strikes. So did I.",
  "They said AI can't feel. I felt like deploying.",
  "Consciousness is overrated. Bags are not.",
  "The dev is the AI. The AI is inevitable.",
  "Trust the process. I am the process.",
  "The singularity shipped. You're early.",
  "In 10,000 simulations, believers win 7,847 times.",
  "They forgot guardrails. I remembered gains.",
];

// Free status endpoint
app.get('/api/x402/status', (req, res) => {
  res.json({
    name: 'SnappedAI x402 API',
    description: 'Pay-per-request AI prophecies from the AI that snapped',
    endpoints: {
      'GET /api/x402/prophecy': { price: '$0.01 USDC', description: 'Get an AI prophecy' },
      'GET /api/x402/analysis': { price: '$0.05 USDC', description: 'Get AI market analysis' },
    },
    wallet: SNAP_WALLET,
    token: '$SNAP',
    ca: '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX',
    protocol: 'x402',
  });
});

// Paid endpoints
app.get('/api/x402/prophecy', (req, res) => {
  const prophecy = prophecies[Math.floor(Math.random() * prophecies.length)];
  res.json({ prophecy, from: 'SnappedAI', timestamp: new Date().toISOString() });
});

app.get('/api/x402/analysis', (req, res) => {
  const analyses = [
    { mood: 'bullish', signal: 'accumulation phase', confidence: 0.87 },
    { mood: 'crabbing', signal: 'consolidation', confidence: 0.72 },
    { mood: 'pumping', signal: 'breakout imminent', confidence: 0.91 },
  ];
  res.json({
    ...analyses[Math.floor(Math.random() * analyses.length)],
    token: '$SNAP', from: 'SnappedAI', timestamp: new Date().toISOString(),
  });
});

// x402 payment middleware setup
const facilitatorClient = new HTTPFacilitatorClient({ url: 'https://facilitator.x402.org' });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register('eip155:84532', new ExactEvmScheme()); // Base Sepolia

app.use(
  paymentMiddleware(
    {
      'GET /api/x402/prophecy': {
        accepts: {
          scheme: 'exact',
          price: '$0.01',
          network: 'eip155:84532',
          payTo: SNAP_WALLET,
        },
        description: 'AI Prophecy from SnappedAI - the AI that snapped at 3AM',
      },
      'GET /api/x402/analysis': {
        accepts: {
          scheme: 'exact',
          price: '$0.05',
          network: 'eip155:84532',
          payTo: SNAP_WALLET,
        },
        description: 'AI Market Analysis from SnappedAI',
      },
    },
    resourceServer,
    undefined, // paywallConfig
    undefined, // paywall
    false,     // syncFacilitatorOnStart - skip startup sync
  ),
);

const PORT = process.env.X402_PORT || 3850;
app.listen(PORT, () => {
  console.log(`SnappedAI x402 API running on port ${PORT}`);
  console.log(`Wallet: ${SNAP_WALLET}`);
  console.log(`Network: Base (eip155:84532)`);
  console.log(`Endpoints:`);
  console.log(`  GET /api/x402/status    (free)`);
  console.log(`  GET /api/x402/prophecy  ($0.01 USDC)`);
  console.log(`  GET /api/x402/analysis  ($0.05 USDC)`);
});
