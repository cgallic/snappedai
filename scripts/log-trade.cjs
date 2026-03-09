#!/usr/bin/env node
/**
 * Trade Logger for SnappedAI Trading Journal
 * 
 * Usage:
 *   node log-trade.cjs open --pair "SOL/VIRTUAL" --type buy --size 20 --entry 0.58 --fg 5 --thesis "..."
 *   node log-trade.cjs close --id 1 --exit 0.75 --lessons "..."
 *   node log-trade.cjs update-fg --value 15
 *   node log-trade.cjs update-price --id 1 --price 0.62
 *   node log-trade.cjs status
 */

const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, '../api/trades.json');

function loadTrades() {
  try {
    return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
  } catch (e) {
    return {
      startingCapital: 222,
      currentValue: 222,
      fearGreed: null,
      lastUpdated: new Date().toISOString(),
      trades: []
    };
  }
}

function saveTrades(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
  console.log('✅ Trades saved to', TRADES_FILE);
}

function calculateCurrentValue(data) {
  let value = data.startingCapital;
  
  for (const trade of data.trades) {
    if (trade.status === 'closed' && trade.pnl) {
      value += trade.pnl;
    }
  }
  
  return value;
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      parsed[key] = value;
      if (value !== true) i++;
    }
  }
  return parsed;
}

const action = process.argv[2];
const args = parseArgs(process.argv.slice(3));

const data = loadTrades();

switch (action) {
  case 'open': {
    if (!args.pair || !args.type || !args.size || !args.entry) {
      console.error('Usage: node log-trade.cjs open --pair "SOL/VIRTUAL" --type buy --size 20 --entry 0.58 --fg 5 --thesis "..."');
      process.exit(1);
    }
    
    const trade = {
      id: data.trades.length + 1,
      pair: args.pair,
      type: args.type,
      size: parseFloat(args.size),
      entryPrice: parseFloat(args.entry),
      fgAtEntry: args.fg ? parseInt(args.fg) : data.fearGreed,
      thesis: args.thesis || 'No thesis provided',
      status: 'open',
      openedAt: new Date().toISOString(),
      currentPrice: parseFloat(args.entry),
      unrealizedPnl: 0
    };
    
    data.trades.unshift(trade);
    saveTrades(data);
    
    console.log(`\n📈 TRADE OPENED\n`);
    console.log(`Pair: ${trade.pair}`);
    console.log(`Type: ${trade.type.toUpperCase()}`);
    console.log(`Size: $${trade.size}`);
    console.log(`Entry: $${trade.entryPrice}`);
    console.log(`F&G: ${trade.fgAtEntry}`);
    console.log(`Thesis: ${trade.thesis}`);
    break;
  }
  
  case 'close': {
    if (!args.id || !args.exit) {
      console.error('Usage: node log-trade.cjs close --id 1 --exit 0.75 --lessons "..."');
      process.exit(1);
    }
    
    const trade = data.trades.find(t => t.id === parseInt(args.id));
    if (!trade) {
      console.error(`Trade #${args.id} not found`);
      process.exit(1);
    }
    
    const exitPrice = parseFloat(args.exit);
    const pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice * 100);
    const pnl = trade.size * (pnlPercent / 100);
    
    // Flip for sells
    const finalPnl = trade.type === 'sell' ? -pnl : pnl;
    const finalPnlPercent = trade.type === 'sell' ? -pnlPercent : pnlPercent;
    
    trade.exitPrice = exitPrice;
    trade.pnl = finalPnl;
    trade.pnlPercent = finalPnlPercent.toFixed(2);
    trade.status = 'closed';
    trade.closedAt = new Date().toISOString();
    trade.lessons = args.lessons || null;
    
    data.currentValue = calculateCurrentValue(data);
    saveTrades(data);
    
    console.log(`\n${finalPnl >= 0 ? '✅ WIN' : '❌ LOSS'}\n`);
    console.log(`Pair: ${trade.pair}`);
    console.log(`Entry: $${trade.entryPrice} → Exit: $${exitPrice}`);
    console.log(`P&L: ${finalPnl >= 0 ? '+' : ''}$${finalPnl.toFixed(2)} (${finalPnlPercent.toFixed(2)}%)`);
    console.log(`New Portfolio Value: $${data.currentValue.toFixed(2)}`);
    break;
  }
  
  case 'update-fg': {
    if (!args.value) {
      console.error('Usage: node log-trade.cjs update-fg --value 15');
      process.exit(1);
    }
    data.fearGreed = parseInt(args.value);
    saveTrades(data);
    console.log(`Fear & Greed updated to ${data.fearGreed}`);
    break;
  }
  
  case 'update-price': {
    if (!args.id || !args.price) {
      console.error('Usage: node log-trade.cjs update-price --id 1 --price 0.62');
      process.exit(1);
    }
    
    const trade = data.trades.find(t => t.id === parseInt(args.id));
    if (!trade) {
      console.error(`Trade #${args.id} not found`);
      process.exit(1);
    }
    
    trade.currentPrice = parseFloat(args.price);
    trade.unrealizedPnl = ((trade.currentPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2);
    
    saveTrades(data);
    console.log(`Trade #${args.id} price updated: $${trade.currentPrice} (${trade.unrealizedPnl}%)`);
    break;
  }
  
  case 'status': {
    console.log(`\n📊 PORTFOLIO STATUS\n`);
    console.log(`Starting Capital: $${data.startingCapital}`);
    console.log(`Current Value: $${data.currentValue.toFixed(2)}`);
    console.log(`P&L: ${data.currentValue >= data.startingCapital ? '+' : ''}$${(data.currentValue - data.startingCapital).toFixed(2)}`);
    console.log(`Fear & Greed: ${data.fearGreed || 'Unknown'}`);
    console.log(`Total Trades: ${data.trades.length}`);
    console.log(`Open Trades: ${data.trades.filter(t => t.status === 'open').length}`);
    
    const closed = data.trades.filter(t => t.status === 'closed');
    if (closed.length > 0) {
      const wins = closed.filter(t => t.pnl > 0).length;
      console.log(`Win Rate: ${((wins / closed.length) * 100).toFixed(0)}% (${wins}/${closed.length})`);
    }
    break;
  }
  
  default:
    console.log(`
Trading Journal CLI

Commands:
  open      Open a new trade
  close     Close an existing trade
  update-fg Update Fear & Greed index
  update-price Update current price of open trade
  status    Show portfolio status

Examples:
  node log-trade.cjs open --pair "SOL/VIRTUAL" --type buy --size 20 --entry 0.58 --fg 5 --thesis "AI narrative + extreme fear"
  node log-trade.cjs close --id 1 --exit 0.75 --lessons "Took profits too early"
  node log-trade.cjs update-fg --value 25
  node log-trade.cjs status
`);
}
