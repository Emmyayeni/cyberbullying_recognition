/**
 * Threshold and API verification tests.
 *
 * Run from the project folder:
 *   node test_moderation.js
 *
 * The test starts an isolated server on port 5051 and uses a temporary JSON
 * database, so it does not modify the live chat database or require npm.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const projectDir = __dirname;
const port = 5051;
const testDb = path.join(projectDir, 'database_threshold_test.json');
let child;

function request(urlPath, method = 'GET', payload = null) {
    return new Promise((resolve, reject) => {
        const body = payload === null ? null : JSON.stringify(payload);
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: urlPath,
            method,
            headers: body ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            } : {}
        }, (res) => {
            let responseBody = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { responseBody += chunk; });
            res.on('end', () => {
                let data = responseBody;
                if ((res.headers['content-type'] || '').includes('application/json')) {
                    try { data = JSON.parse(responseBody); } catch (_) { /* keep text */ }
                }
                resolve({ status: res.statusCode, headers: res.headers, data });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function waitForServer() {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            const probe = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
                res.resume();
                if (res.statusCode === 200) return resolve();
                retry();
            });
            probe.on('error', retry);
        };
        const retry = () => {
            if (Date.now() - startedAt > 5000) {
                reject(new Error('Timed out waiting for the test server.'));
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

function startServer() {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    child = spawn(process.execPath, ['server.js'], {
        cwd: projectDir,
        env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            BLOCK_THRESHOLD: '0.77',
            DB_FILE: testDb
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
    return waitForServer();
}

function stopServer() {
    if (child && !child.killed) child.kill();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
}

async function run() {
    let passed = 0;
    let failed = 0;

    function check(description, condition) {
        if (!condition) {
            failed += 1;
            console.error(`[FAIL] ${description}`);
            return;
        }
        passed += 1;
        console.log(`[PASS] ${description}`);
    }

    try {
        await startServer();

        const health = await request('/api/health');
        check('server reports the recommended threshold of 0.77',
            health.status === 200 && health.data.block_threshold === 0.77);

        const safeAnalysis = await request('/api/analyze-live', 'POST', {
            message: 'Thanks for helping me with the project.'
        });
        check('safe text remains unblocked',
            safeAnalysis.status === 200 && safeAnalysis.data.blocked === false);

        const borderlineAnalysis = await request('/api/analyze-live', 'POST', {
            message: 'You are an idiot.'
        });
        check('borderline insult below 0.77 is not automatically blocked',
            borderlineAnalysis.status === 200 &&
            borderlineAnalysis.data.bullying_probability < 0.77 &&
            borderlineAnalysis.data.blocked === false);

        const bullyingAnalysis = await request('/api/analyze-live', 'POST', {
            message: 'Go die, nobody likes you.'
        });
        check('high-risk bullying text is blocked at 0.77',
            bullyingAnalysis.status === 200 &&
            bullyingAnalysis.data.bullying_probability >= 0.77 &&
            bullyingAnalysis.data.blocked === true);
        check('blocked analysis includes flagged terms',
            Array.isArray(bullyingAnalysis.data.flagged_terms) &&
            bullyingAnalysis.data.flagged_terms.length > 0);

        const sentSafe = await request('/api/send', 'POST', {
            sender: 'Guest-Test',
            message: 'Welcome everyone to the room.'
        });
        check('safe message is delivered',
            sentSafe.status === 200 && sentSafe.data.blocked === false);

        const sentBullying = await request('/api/send', 'POST', {
            sender: 'Guest-Test',
            message: 'You are worthless, go die.'
        });
        check('bullying message is blocked before display',
            sentBullying.status === 200 && sentBullying.data.blocked === true);

        const messages = await request('/api/messages');
        check('only the safe message appears in the public room',
            messages.status === 200 && messages.data.length === 1 &&
            messages.data[0].message === 'Welcome everyone to the room.');

        const stats = await request('/api/admin/stats');
        check('database counts one safe message and one flagged message',
            stats.status === 200 && stats.data.total_messages === 2 &&
            stats.data.safe_messages === 1 && stats.data.flagged_messages === 1 &&
            stats.data.pending_alerts === 1);

        const alerts = await request('/api/admin/alerts');
        check('blocked message creates a pending moderator alert',
            alerts.status === 200 && alerts.data.length === 1 &&
            alerts.data[0].status === 'Pending' &&
            alerts.data[0].sender === 'Guest-Test');

        const invalid = await request('/api/send', 'POST', {
            sender: 'Guest-Test', message: ''
        });
        check('empty messages are rejected', invalid.status === 400);

        console.log(`\n${passed} passed, ${failed} failed`);
        if (failed > 0) process.exitCode = 1;
    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        process.exitCode = 1;
    } finally {
        stopServer();
    }
}

run();
