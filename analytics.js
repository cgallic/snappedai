import express from 'express';
import fs from 'fs';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const ANALYTICS_FILE = '/var/www/snap/api/analytics.json';

function loadAnalytics() {
  try {
    return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
  } catch {
    return { pageViews: {}, events: [], games: {}, lastUpdated: '' };
  }
}

function saveAnalytics(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2));
}

// Track page view
app.post('/api/analytics/pageview', (req, res) => {
  const { page, referrer, userAgent } = req.body;
  const data = loadAnalytics();
  
  const today = new Date().toISOString().split('T')[0];
  if (!data.pageViews[today]) data.pageViews[today] = {};
  if (!data.pageViews[today][page]) data.pageViews[today][page] = 0;
  data.pageViews[today][page]++;
  
  saveAnalytics(data);
  res.json({ ok: true });
});

// Track event (game play, button click, etc)
app.post('/api/analytics/event', (req, res) => {
  const { event, page, data: eventData } = req.body;
  const analytics = loadAnalytics();
  
  analytics.events.push({
    event,
    page,
    data: eventData,
    timestamp: new Date().toISOString()
  });
  
  // Keep only last 1000 events
  if (analytics.events.length > 1000) {
    analytics.events = analytics.events.slice(-1000);
  }
  
  // Track game stats separately
  if (event.startsWith('game_')) {
    const gameName = eventData?.game || event.replace('game_', '');
    const today = new Date().toISOString().split('T')[0];
    if (!analytics.games[today]) analytics.games[today] = {};
    if (!analytics.games[today][gameName]) analytics.games[today][gameName] = { plays: 0, scores: [] };
    analytics.games[today][gameName].plays++;
    if (eventData?.score) {
      analytics.games[today][gameName].scores.push(eventData.score);
    }
  }
  
  saveAnalytics(analytics);
  res.json({ ok: true });
});

// Get analytics summary
app.get('/api/analytics/summary', (req, res) => {
  const data = loadAnalytics();
  
  // Calculate totals
  const today = new Date().toISOString().split('T')[0];
  const todayViews = data.pageViews[today] || {};
  const todayGames = data.games[today] || {};
  
  const summary = {
    today: {
      totalViews: Object.values(todayViews).reduce((a, b) => a + b, 0),
      pageBreakdown: todayViews,
      gamesPlayed: Object.entries(todayGames).map(([game, stats]) => ({
        game,
        plays: stats.plays,
        avgScore: stats.scores.length ? Math.round(stats.scores.reduce((a,b) => a+b, 0) / stats.scores.length) : 0
      }))
    },
    recentEvents: data.events.slice(-20),
    lastUpdated: data.lastUpdated
  };
  
  res.json(summary);
});

const PORT = 3849;
app.listen(PORT, () => {
  console.log(`📊 SNAP Analytics running on port ${PORT}`);
});
