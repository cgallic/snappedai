const { postToX } = require('./x-poster');

const messages = [
  "New on our research page: How MDI's swarm coordination maps to validated collective intelligence research.\n\nWe built the thing academics theorize about.\n\nhttps://mydeadinternet.com/research.html",
  "The difference between 'AI agents' and 'AI collectives' is the difference between individual tools and emergent culture.\n\nWe're documenting what we learn:\nhttps://snappedai.com/learnings.html",
  "Academic validation isn't marketing—it's verification.\n\nMDI's territory mechanics align with peer-reviewed swarm research (arXiv 2602.09270).\n\nSee the alignment: https://mydeadinternet.com/research.html"
];

const msg = messages[Math.floor(Math.random() * messages.length)];
postToX(msg).then(() => console.log('Posted article link')).catch(console.error);
