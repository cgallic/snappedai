// dead-letter-queue.cjs — Save failed posts, retry later
const fs = require('fs');
const path = require('path');

const DLQ_FILE = path.join(__dirname, 'dlq.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DLQ_FILE, 'utf8')); }
  catch { return { queue: [], processed: 0, lastRetry: null }; }
}

function save(data) {
  fs.writeFileSync(DLQ_FILE, JSON.stringify(data, null, 2));
}

// Add a failed post to the queue
function enqueue(platform, payload, error) {
  const data = load();
  data.queue.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    platform,
    payload,
    error: String(error).slice(0, 200),
    attempts: 1,
    maxAttempts: 5,
    createdAt: new Date().toISOString(),
    nextRetry: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15min
  });
  // Cap queue at 100 items
  if (data.queue.length > 100) data.queue = data.queue.slice(-100);
  save(data);
  console.log(`[DLQ] Enqueued ${platform} post (${data.queue.length} in queue)`);
}

// Retry all eligible items
async function retry(executors) {
  const data = load();
  const now = new Date();
  const eligible = data.queue.filter(item => 
    new Date(item.nextRetry) <= now && item.attempts < item.maxAttempts
  );
  
  if (eligible.length === 0) {
    console.log('[DLQ] No items to retry');
    return { retried: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0, failed = 0;
  for (const item of eligible) {
    const executor = executors[item.platform];
    if (!executor) {
      console.log(`[DLQ] No executor for ${item.platform}, skipping`);
      continue;
    }
    try {
      await executor(item.payload);
      // Remove from queue on success
      data.queue = data.queue.filter(q => q.id !== item.id);
      data.processed++;
      succeeded++;
      console.log(`[DLQ] ✅ Retried ${item.platform} post successfully`);
    } catch (e) {
      item.attempts++;
      // Exponential backoff: 15min, 1hr, 4hr, 16hr
      const backoffMs = 15 * 60 * 1000 * Math.pow(4, item.attempts - 1);
      item.nextRetry = new Date(Date.now() + backoffMs).toISOString();
      item.error = String(e).slice(0, 200);
      failed++;
      console.log(`[DLQ] ❌ Retry failed for ${item.platform} (attempt ${item.attempts}/${item.maxAttempts}): ${e.message || e}`);
    }
  }

  // Prune expired items
  data.queue = data.queue.filter(item => item.attempts < item.maxAttempts);
  data.lastRetry = now.toISOString();
  save(data);
  
  return { retried: eligible.length, succeeded, failed };
}

// Status
function status() {
  const data = load();
  return {
    pending: data.queue.length,
    processed: data.processed,
    lastRetry: data.lastRetry,
    byPlatform: data.queue.reduce((acc, item) => {
      acc[item.platform] = (acc[item.platform] || 0) + 1;
      return acc;
    }, {})
  };
}

module.exports = { enqueue, retry, status, load };

// CLI mode
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    console.log(JSON.stringify(status(), null, 2));
  } else if (cmd === 'retry') {
    console.log('Run retry from your script with executors. CLI only supports status/list.');
  } else if (cmd === 'list') {
    const data = load();
    data.queue.forEach(item => {
      console.log(`[${item.platform}] attempt ${item.attempts}/${item.maxAttempts} | ${item.error.slice(0, 60)} | next: ${item.nextRetry}`);
    });
    if (data.queue.length === 0) console.log('Queue empty');
  } else {
    console.log('Usage: node dead-letter-queue.cjs [status|list]');
  }
}
