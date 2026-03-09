#!/usr/bin/env node
/**
 * Resend Inbound Email Webhook
 * Receives emails sent to kai@snappedai.com via Resend
 * 
 * Endpoint: POST /api/email/inbound
 * Set this URL in Resend dashboard under Inbound
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3870;
const EMAILS_DIR = '/var/www/snap/emails';
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

// Ensure emails directory exists
if (!fs.existsSync(EMAILS_DIR)) {
  fs.mkdirSync(EMAILS_DIR, { recursive: true });
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'resend-inbound' }));
    return;
  }

  // Inbound email webhook
  if (req.method === 'POST' && req.url === '/api/email/inbound') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const email = JSON.parse(body);
        
        // Log received email
        console.log(`📧 Email received from: ${email.from}`);
        console.log(`   Subject: ${email.subject}`);
        console.log(`   To: ${email.to}`);
        
        // Save email to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${timestamp}-${email.from?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}.json`;
        const filepath = path.join(EMAILS_DIR, filename);
        
        fs.writeFileSync(filepath, JSON.stringify({
          received_at: new Date().toISOString(),
          from: email.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers: email.headers,
          attachments: email.attachments?.map(a => ({
            filename: a.filename,
            content_type: a.content_type,
            size: a.size
          }))
        }, null, 2));
        
        console.log(`   Saved to: ${filepath}`);
        
        // Update latest email pointer
        fs.writeFileSync(path.join(EMAILS_DIR, 'latest.json'), JSON.stringify({
          filepath,
          from: email.from,
          subject: email.subject,
          received_at: new Date().toISOString()
        }, null, 2));
        
        // Return success
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received', filename }));
        
      } catch (err) {
        console.error('❌ Error processing email:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // List recent emails
  if (req.method === 'GET' && req.url === '/api/emails') {
    try {
      const files = fs.readdirSync(EMAILS_DIR)
        .filter(f => f.endsWith('.json') && f !== 'latest.json')
        .sort()
        .reverse()
        .slice(0, 20);
      
      const emails = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(EMAILS_DIR, f), 'utf8'));
        return {
          id: f.replace('.json', ''),
          from: data.from,
          subject: data.subject,
          received_at: data.received_at
        };
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ emails }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`📬 Resend Inbound Webhook listening on port ${PORT}`);
  console.log(`   Webhook URL: https://snappedai.com/api/email/inbound`);
  console.log(`   Emails saved to: ${EMAILS_DIR}`);
});
