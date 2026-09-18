/**
 * Cyberbullying AI Safe Chat - Zero-Dependency Node.js Server Alternative
 * Can be run with: node server.js
 * Works in parallel with Flask app.py (Python)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 5000;
const BLOCK_THRESHOLD = parseFloat(process.env.BLOCK_THRESHOLD || '0.77');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'database_node.json');
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 30;

// In-Memory Database with JSON Persistence
let db = {
    messages: [],
    alerts: []
};

// Connected browser tabs for the zero-dependency fallback server.
const sseClients = new Map();

function broadcastSSE(eventName, payload) {
    const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients.keys()) {
        try { client.write(body); } catch (e) { sseClients.delete(client); }
    }
}

function presenceSnapshot() {
    return {
        online: Math.max(1, sseClients.size),
        members: [...new Set([...sseClients.values()].filter(Boolean))].sort()
    };
}

function broadcastPresence() {
    broadcastSSE('presence', presenceSnapshot());
}

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch (e) {
        console.warn('Could not read existing JSON db, initializing fresh.');
    }
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to persist database:', e);
    }
}

// Cyberbullying Heuristic Engine
const HIGH_SEVERITY = [
    /\b(kill|die|hang)\s+(your\s*self|ur\s*self)\b/i,
    /\bgo\s+die\b/i,
    /\bi('ll|\s*will)\s+(hunt|find|beat|hurt|destroy|kill)\s+you\b/i,
    /\b(nobody|no\s*one)\s+(likes|wants|cares\s+about)\s+you\b/i,
    /\byou\s+deserve\s+to\s+(die|suffer|be\s+hurt)\b/i,
    /\bu\s+r\s+(worthless|pathetic|trash|garbage|disgusting)\b/i,
    /\byou('re|\s+are)\s+(worthless|pathetic|disgusting|trash|garbage|a\s+waste\s+of\s+space)\b/i
];

const MODERATE_SEVERITY = [
    /\b(loser|idiot|moron|stupid|dumbass|ugly|fat|creep|freak|bitch|bastard|asshole|retard|scum)\b/i,
    /\bshut\s+(the\s*fuck\s*)?up\b/i,
    /\byou('re|\s+are)\s+(so\s+)?(dumb|stupid|annoying|useless|pathetic|fake)\b/i,
    /\bget\s+lost\b/i,
    /\beveryone\s+hates\s+you\b/i,
    /\bdelete\s+your\s+account\b/i,
    /\bfuck\s+(off|you|u)\b/i,
    /\bstop\s+talking\b/i
];

const MILD_TENSION = [
    /\bwhatever\b/i,
    /\byou('re|\s+are)\s+wrong\b/i,
    /\bannoying\b/i,
    /\bterrible\b/i,
    /\bworst\b/i,
    /\bcringe\b/i
];

function extractFlaggedTerms(text) {
    if (!text) return [];
    const flagged = [];
    [...HIGH_SEVERITY, ...MODERATE_SEVERITY].forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            matches.forEach(m => {
                if (!flagged.includes(m.toLowerCase())) flagged.push(m.toLowerCase());
            });
        }
    });
    return flagged;
}

function classifyText(text) {
    if (!text || !text.trim()) {
        return {
            classification: 'SAFE',
            confidence: 0.99,
            bullying_probability: 0.01,
            blocked: false,
            category: 'Neutral',
            flagged_terms: [],
            risk_level: 'Safe',
            nudge: 'Message looks good.'
        };
    }

    const raw = text.trim();
    let prob = 0.05;
    let category = 'Safe';
    let risk_level = 'Safe';
    let nudge = 'Safe & constructive tone.';

    const highHits = HIGH_SEVERITY.filter(p => p.test(raw));
    const modHits = MODERATE_SEVERITY.filter(p => p.test(raw));
    const mildHits = MILD_TENSION.filter(p => p.test(raw));

    if (highHits.length > 0) {
        prob = Math.min(0.98, 0.85 + (highHits.length * 0.05));
        category = 'Severe Threat / Harassment';
        risk_level = 'High Risk';
        nudge = 'Warning: Extreme cyberbullying or personal threat detected.';
    } else if (modHits.length > 0) {
        prob = Math.min(0.88, 0.60 + (modHits.length * 0.08));
        category = 'Insult / Derogatory Attack';
        risk_level = 'High Risk';
        nudge = 'Warning: Hurtful or aggressive language detected.';
    } else if (mildHits.length > 0) {
        prob = Math.min(0.45, 0.25 + (mildHits.length * 0.06));
        category = 'Tense / Borderline';
        risk_level = 'Mild Risk';
        nudge = 'Tone check: Mild tension detected.';
    }

    const upperCount = raw.replace(/[^A-Z]/g, '').length;
    if (upperCount / raw.length > 0.6 && raw.length > 8) {
        prob = Math.min(0.95, prob + 0.15);
    }

    const blocked = prob >= BLOCK_THRESHOLD;
    const flagged = extractFlaggedTerms(raw);

    return {
        classification: blocked ? 'CYBERBULLYING' : 'SAFE',
        confidence: blocked ? prob : (1.0 - prob),
        bullying_probability: Math.round(prob * 10000) / 10000,
        blocked: blocked,
        category: category,
        flagged_terms: flagged,
        risk_level: risk_level,
        nudge: nudge
    };
}

// MIME Types
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function renderTemplate(filename) {
    let content = fs.readFileSync(path.join(__dirname, 'templates', filename), 'utf-8');
    content = content.replace(/\{\{\s*threshold\s*\}\}/g, Math.round(BLOCK_THRESHOLD * 100));
    content = content.replace(/\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}/g, '/static/$1');
    return content;
}

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // Helper for JSON
    const sendJson = (statusCode, obj) => {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
    };

    // Static Files
    if (pathname.startsWith('/static/')) {
        const filePath = path.join(__dirname, pathname);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
            return fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404);
            return res.end('File Not Found');
        }
    }

    // Routes
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderTemplate('index.html'));
    }

    if (req.method === 'GET' && pathname === '/admin') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderTemplate('admin.html'));
    }

    // API: Health
    if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(200, {
            status: 'ok',
            model_ready: false,
            engine: 'heuristic_fallback',
            block_threshold: BLOCK_THRESHOLD
        });
    }

    // API: Model Info
    if (req.method === 'GET' && pathname === '/api/model/info') {
        const modelPath = path.join(__dirname, 'model', 'cyberbullying_pipeline.pkl');
        const metaPath = path.join(__dirname, 'model', 'model_metadata.json');
        let metadata = {
            model: 'Baseline Heuristic Engine',
            description: 'Rule-based lexical and sentiment analyzer. Train on Colab to enable ML pipeline.',
            default_block_threshold: BLOCK_THRESHOLD
        };
        if (fs.existsSync(metaPath)) {
            try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch(e){}
        }

        return sendJson(200, {
            model_ready: false,
            engine: 'heuristic_fallback',
            block_threshold: BLOCK_THRESHOLD,
            metadata: {
                ...metadata,
                runtime_notice: 'The Node fallback cannot execute scikit-learn model files. Run app.py for ML inference.'
            }
        });
    }

    // API: Messages List
    if (req.method === 'GET' && pathname === '/api/messages') {
        const visible = db.messages.filter(m => !m.blocked).slice(-100);
        return sendJson(200, visible);
    }

    // Real-time shared chat stream (Server-Sent Events).
    if (req.method === 'GET' && pathname === '/api/events') {
        const requestedName = String(parsed.query.name || '').trim();
        const guestName = requestedName.length >= MIN_NAME_LENGTH && requestedName.length <= MAX_NAME_LENGTH
            ? requestedName
            : 'Anonymous guest';
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        sseClients.set(res, guestName);
        res.write(`event: ready\ndata: ${JSON.stringify(presenceSnapshot())}\n\n`);
        broadcastPresence();
        const heartbeat = setInterval(() => {
            try { res.write(': keep-alive\n\n'); } catch (e) { clearInterval(heartbeat); }
        }, 20000);
        req.on('close', () => {
            clearInterval(heartbeat);
            sseClients.delete(res);
            broadcastPresence();
        });
        return;
    }

    // API: Analyze Live
    if (req.method === 'POST' && pathname === '/api/analyze-live') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let parsedBody = {};
            try { parsedBody = JSON.parse(body || '{}'); } catch(e){}
            const result = classifyText(parsedBody.message || '');
            return sendJson(200, result);
        });
        return;
    }

    // API: Send Message
    if (req.method === 'POST' && pathname === '/api/send') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let payload = {};
            try { payload = JSON.parse(body || '{}'); } catch(e){}
            const sender = (payload.sender || '').trim();
            const message = (payload.message || '').trim();

            if (sender.length < MIN_NAME_LENGTH || sender.length > MAX_NAME_LENGTH) {
                return sendJson(400, { error: `Display name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters.` });
            }
            if (!message) {
                return sendJson(400, { error: 'Message cannot be empty.' });
            }
            if (message.length > 1000) {
                return sendJson(400, { error: 'Message must be 1000 characters or fewer.' });
            }

            const result = classifyText(message);
            const msgId = db.messages.length + 1;
            const now = new Date().toISOString();

            const msgObj = {
                id: msgId,
                sender: sender,
                message: message,
                classification: result.classification,
                confidence: result.confidence,
                bullying_probability: result.bullying_probability,
                category: result.category,
                flagged_terms: result.flagged_terms,
                blocked: result.blocked ? 1 : 0,
                created_at: now
            };
            db.messages.push(msgObj);

            if (result.blocked) {
                db.alerts.push({
                    alert_id: db.alerts.length + 1,
                    message_id: msgId,
                    alert_type: 'Cyberbullying',
                    status: 'Pending',
                    sender: sender,
                    message: message,
                    classification: result.classification,
                    confidence: result.confidence,
                    bullying_probability: result.bullying_probability,
                    category: result.category,
                    flagged_terms: result.flagged_terms,
                    alert_created_at: now
                });
            }

            saveDb();

            if (!result.blocked) broadcastSSE('message', msgObj);

            return sendJson(200, {
                message_id: msgId,
                blocked: result.blocked,
                classification: result.classification,
                confidence: result.confidence,
                bullying_probability: result.bullying_probability,
                category: result.category,
                flagged_terms: result.flagged_terms,
                notice: result.blocked 
                    ? 'Potential cyberbullying detected. Message blocked and administrator alerted.'
                    : 'Message verified safe and delivered.'
            });
        });
        return;
    }

    // API: Admin Stats
    if (req.method === 'GET' && pathname === '/api/admin/stats') {
        const total = db.messages.length;
        const safe = db.messages.filter(m => !m.blocked).length;
        const flagged = db.messages.filter(m => m.blocked).length;
        const pending = db.alerts.filter(a => a.status === 'Pending').length;
        const reviewed = db.alerts.filter(a => a.status === 'Reviewed').length;
        const rate = total ? (flagged / total * 100) : 0;
        const safetyIndex = total ? (safe / total * 100) : 100;

        const recent = db.messages.slice(-15).map(m => ({
            id: m.id,
            sender: m.sender,
            blocked: m.blocked,
            bullying_probability: m.bullying_probability,
            created_at: m.created_at
        }));

        return sendJson(200, {
            total_messages: total,
            safe_messages: safe,
            flagged_messages: flagged,
            detection_rate: Math.round(rate * 10) / 10,
            safety_index: Math.round(safetyIndex * 10) / 10,
            total_alerts: db.alerts.length,
            pending_alerts: pending,
            reviewed_alerts: reviewed,
            recent_activity: recent
        });
    }

    // API: Admin Alerts
    if (req.method === 'GET' && pathname === '/api/admin/alerts') {
        const filter = (parsed.query.status || 'all').toLowerCase();
        let list = [...db.alerts].reverse();
        if (filter !== 'all') {
            list = list.filter(a => a.status.toLowerCase() === filter);
        }
        return sendJson(200, list.slice(0, 100));
    }

    // API: Alert Review
    if (req.method === 'POST' && pathname.startsWith('/api/admin/alerts/') && pathname.endsWith('/review')) {
        const parts = pathname.split('/');
        const alertId = parseInt(parts[4]);
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            let payload = {};
            try { payload = JSON.parse(body || '{}'); } catch(e){}
            const action = payload.action || 'Reviewed';
            const alert = db.alerts.find(a => a.alert_id === alertId);
            if (alert) {
                alert.status = action === 'Dismiss' ? 'Dismissed' : 'Reviewed';
                alert.reviewed_at = new Date().toISOString();
                saveDb();
                return sendJson(200, { success: true, alert_id: alertId, status: alert.status });
            }
            return sendJson(404, { error: 'Alert not found.' });
        });
        return;
    }

    // API: Clear Demo Data
    if (req.method === 'POST' && pathname === '/api/admin/clear') {
        db.messages = [];
        db.alerts = [];
        saveDb();
        return sendJson(200, { success: true, message: 'Demo data cleared.' });
    }

    // API: Export CSV
    if (req.method === 'GET' && pathname === '/api/admin/export') {
        let csv = 'Alert ID,Status,Sender,Message,Bullying Probability (%),Classification,Category,Flagged Words,Created At,Reviewed At\n';
        db.alerts.forEach(a => {
            const cleanMsg = (a.message || '').replace(/"/g, '""');
            const prob = Math.round((a.bullying_probability || 0) * 100);
            csv += `"${a.alert_id}","${a.status}","${a.sender}","${cleanMsg}","${prob}","${a.classification}","${a.category || 'Harassment'}","${(a.flagged_terms || []).join('; ')}","${a.alert_created_at}","${a.reviewed_at || ''}"\n`;
        });
        res.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename=cyberbullying_moderation_report.csv'
        });
        return res.end(csv);
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`\n=======================================================`);
    console.log(` AI Safe Chat & Cyberbullying Incident Monitor`);
    console.log(` Running on: http://127.0.0.1:${PORT}`);
    console.log(` Admin Monitor: http://127.0.0.1:${PORT}/admin`);
    console.log(`=======================================================\n`);
});
