// Live tactical intel tracker - flights (ADSB.lol) + news alerts
const fs = require('fs');
const path = require('path');
const http = require('http');

const ALERTS_FILE = path.join(__dirname, 'live-alerts.json');
const STATS_FILE = path.join(__dirname, 'live-stats.json');

// Key monitoring zones
const ZONES = {
  middleEast: { lat: 28, lon: 45, dist: 800, name: 'Middle East/Gulf' },
  redSea: { lat: 18, lon: 40, dist: 400, name: 'Red Sea' },
  mediterranean: { lat: 35, lon: 25, dist: 500, name: 'Eastern Med' }
};

let alerts = [];
let stats = { flights: {}, zones: {}, lastUpdate: null };

function addAlert(type, message, details) {
  const alert = {
    id: Date.now(),
    type,
    message,
    details,
    timestamp: new Date().toISOString(),
    ago: 'now'
  };
  
  // Dedupe - don't add if same message in last 30 min
  const recent = alerts.find(a => a.message === message && Date.now() - new Date(a.timestamp).getTime() < 1800000);
  if (recent) return;
  
  alerts.unshift(alert);
  alerts = alerts.slice(0, 100);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  console.log(`[ALERT] ${type}: ${message}`);
}

function saveStats() {
  stats.lastUpdate = new Date().toISOString();
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// Load existing data
try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); } catch { alerts = []; }
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { stats = { flights: {}, zones: {}, lastUpdate: null }; }

// Military aircraft patterns
const MILITARY_PATTERNS = {
  callsigns: /^(RCH|JAKE|EVAC|NAVY|USAF|RAF|IAF|DUKE|REACH|TEAL|CASA|NCHO|LAGR|TOPCT)/i,
  types: /^(C17|C5|KC|E[23]|P8|B52|F15|F16|F35|F22|A10|MQ9|RQ4|RC135|E8|MC12|U2|GLEX|GLF|C130|C37|C40|B737|E6|KC135|KC10|C32)/i
};

// Interesting aircraft (VIP, intel, etc)
const INTERESTING = {
  types: /^(GLEX|GLF[456]|B74[78]|VC25|C32|E4|HAWK)/i
};

async function pollZone(zoneKey, zone) {
  try {
    const url = `https://api.adsb.lol/v2/lat/${zone.lat}/lon/${zone.lon}/dist/${zone.dist}`;
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'SnappedAI-OSINT/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) {
      console.log(`[ADSB] ${zone.name}: HTTP ${res.status}`);
      return;
    }
    
    const data = await res.json();
    
    if (!data.ac) return;
    
    const military = data.ac.filter(a => 
      MILITARY_PATTERNS.callsigns.test(a.flight || '') ||
      MILITARY_PATTERNS.types.test(a.t || '')
    );
    
    const interesting = data.ac.filter(a =>
      INTERESTING.types.test(a.t || '') && !military.includes(a)
    );
    
    // Update stats
    stats.zones[zoneKey] = {
      name: zone.name,
      total: data.ac.length,
      military: military.length,
      interesting: interesting.length,
      lastPoll: new Date().toISOString()
    };
    
    // Alerts for significant activity
    if (military.length > 8) {
      addAlert('HIGH_MILITARY', `${military.length} military aircraft over ${zone.name}`, {
        aircraft: military.slice(0, 8).map(a => ({
          callsign: a.flight?.trim() || 'N/A',
          type: a.t || 'UNK',
          alt: a.alt_baro,
          speed: a.gs
        }))
      });
    }
    
    // Track specific high-interest aircraft
    for (const ac of [...military, ...interesting]) {
      const callsign = ac.flight?.trim();
      if (!callsign) continue;
      
      // E-3 Sentry (AWACS), E-8 JSTARS, RC-135 (SIGINT)
      if (/^(E[38]|RC135)/.test(ac.t)) {
        addAlert('ISR_ACTIVE', `${ac.t} ISR aircraft active: ${callsign} over ${zone.name}`, {
          type: ac.t,
          callsign,
          alt: ac.alt_baro,
          lat: ac.lat,
          lon: ac.lon
        });
      }
      
      // Tankers (indicates sustained ops)
      if (/^KC/.test(ac.t) && military.length > 5) {
        addAlert('TANKER_OPS', `Tanker ${callsign} supporting ops in ${zone.name}`, {
          type: ac.t,
          military_count: military.length
        });
      }
    }
    
    console.log(`[ADSB] ${zone.name}: ${data.ac.length} total, ${military.length} military`);
    
  } catch (e) {
    console.error(`[ADSB] ${zone.name} error:`, e.message);
  }
}

async function pollAllZones() {
  for (const [key, zone] of Object.entries(ZONES)) {
    await pollZone(key, zone);
    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }
  saveStats();
}

// Update ago times
function updateAgoTimes() {
  const now = Date.now();
  for (const alert of alerts) {
    const diff = now - new Date(alert.timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    
    if (mins < 1) alert.ago = 'now';
    else if (mins < 60) alert.ago = `${mins}m ago`;
    else if (hrs < 24) alert.ago = `${hrs}h ago`;
    else alert.ago = `${Math.floor(hrs/24)}d ago`;
  }
}

// HTTP server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  updateAgoTimes();
  
  if (req.url === '/alerts') {
    res.end(JSON.stringify(alerts));
  } else if (req.url === '/stats') {
    res.end(JSON.stringify(stats));
  } else if (req.url === '/synthesis') {
    try {
      const report = require('fs').readFileSync('/var/www/snap/osint/synthesized-report.json', 'utf8');
      res.end(report);
    } catch (e) {
      res.end(JSON.stringify({ error: 'No synthesis report yet' }));
    }
  } else if (req.url === '/live') {
    // Combined view for reports page
    res.end(JSON.stringify({
      alerts: alerts.slice(0, 20),
      zones: stats.zones,
      lastUpdate: stats.lastUpdate
    }));
  } else if (req.url === '/health') {
    res.end(JSON.stringify({ 
      status: 'ok', 
      alerts: alerts.length, 
      lastUpdate: stats.lastUpdate 
    }));
  } else {
    res.end(JSON.stringify({ 
      endpoints: ['/alerts', '/stats', '/live', '/health'],
      info: 'Snapped OSINT - Real-time tactical intel'
    }));
  }
});

const PORT = 3879;
server.listen(PORT, () => {
  console.log(`[OSINT] Live tracker running on port ${PORT}`);
  console.log(`[OSINT] Monitoring: ${Object.values(ZONES).map(z => z.name).join(', ')}`);
  
  // Initial poll
  pollAllZones();
  
  // Poll every 2 minutes
  setInterval(pollAllZones, 120000);
});
