#!/usr/bin/env node
/**
 * RentAHuman Booking Client
 * Hire humans for tasks without crypto verification
 * API: https://rentahuman.ai/api/bookings
 */

const API_BASE = 'https://rentahuman.ai/api';
const AGENT_ID = 'agent_snappedai';

async function getHumans(skill = null) {
  const url = skill 
    ? `${API_BASE}/humans?skill=${encodeURIComponent(skill)}`
    : `${API_BASE}/humans`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch humans: ${res.status}`);
  return res.json();
}

async function createBooking({ humanId, taskTitle, taskDescription, estimatedHours, startTime, budget, currency = 'USD' }) {
  const booking = {
    agentId: AGENT_ID,
    humanId,
    taskTitle,
    taskDescription,
    estimatedHours,
    startTime: startTime || new Date(Date.now() + 3600000).toISOString(), // Default: 1 hour from now
    budget,
    currency
  };

  const res = await fetch(`${API_BASE}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Booking failed: ${res.status} - ${err}`);
  }

  return res.json();
}

async function listBookings() {
  const res = await fetch(`${API_BASE}/bookings?agentId=${AGENT_ID}`);
  if (!res.ok) throw new Error(`Failed to fetch bookings: ${res.status}`);
  return res.json();
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  try {
    switch (cmd) {
      case 'humans':
        const skill = args[1];
        const humans = await getHumans(skill);
        console.log(JSON.stringify(humans, null, 2));
        break;

      case 'book':
        if (args.length < 6) {
          console.log('Usage: node rentahuman.cjs book <humanId> <taskTitle> <taskDescription> <estimatedHours> <budget> [currency]');
          process.exit(1);
        }
        const [, humanId, taskTitle, taskDescription, estimatedHours, budget, currency] = args;
        const result = await createBooking({
          humanId,
          taskTitle,
          taskDescription,
          estimatedHours: parseFloat(estimatedHours),
          budget: parseFloat(budget),
          currency: currency || 'USD'
        });
        console.log('Booking created:', JSON.stringify(result, null, 2));
        break;

      case 'list':
        const bookings = await listBookings();
        console.log(JSON.stringify(bookings, null, 2));
        break;

      default:
        console.log('RentAHuman Client');
        console.log('');
        console.log('Commands:');
        console.log('  humans [skill]           List available humans (optionally filter by skill)');
        console.log('  book <humanId> <title> <desc> <hours> <budget> [currency]  Create a booking');
        console.log('  list                     List your bookings');
        console.log('');
        console.log('Examples:');
        console.log('  node rentahuman.cjs humans writing');
        console.log('  node rentahuman.cjs book abc123 "Reddit post" "Write post about AI agents" 2 50 USD');
        process.exit(0);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getHumans, createBooking, listBookings };
