/**
 * Automated Verification Test for Cyberbullying AI Safe Chat
 */
const http = require('http');

function request(urlPath, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 5000,
            path: urlPath,
            method: method,
            headers: {}
        };
        if (data) {
            const jsonStr = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(jsonStr);
        }

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                let parsed = body;
                if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
                    try { parsed = JSON.parse(body); } catch(e) {}
                }
                resolve({ status: res.statusCode, headers: res.headers, data: parsed });
            });
        });
        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function runTests() {
    console.log('>>> Starting Automated System Verification Tests <<<\n');
    let passCount = 0;
    let totalCount = 0;

    function assert(desc, condition) {
        totalCount++;
        if (condition) {
            console.log(`[PASS] ${desc}`);
            passCount++;
        } else {
            console.error(`[FAIL] ${desc}`);
        }
    }

    try {
        // 1. Clear Demo Data First
        await request('/api/admin/clear', 'POST');

        // 2. Health & Model Info
        const health = await request('/api/health');
        assert('GET /api/health returns 200 and status ok', health.status === 200 && health.data.status === 'ok');

        const modelInfo = await request('/api/model/info');
        assert('GET /api/model/info returns threshold and metadata', modelInfo.status === 200 && modelInfo.data.block_threshold === 0.77);

        // 3. Frontend HTML serving
        const chatHtml = await request('/');
        assert('GET / returns 200 and renders AI Safe Chat HTML', chatHtml.status === 200 && chatHtml.data.includes('AI Safe Chat'));

        const adminHtml = await request('/admin');
        assert('GET /admin returns 200 and renders Admin Monitor HTML', adminHtml.status === 200 && adminHtml.data.includes('Incident Monitor'));

        // 4. Static assets
        const css = await request('/static/css/style.css');
        assert('GET /static/css/style.css serves valid stylesheet', css.status === 200 && css.data.includes('--bg-base'));

        const chatJs = await request('/static/js/chat.js');
        assert('GET /static/js/chat.js serves real-time chat client script', chatJs.status === 200 && chatJs.data.includes('connectLiveChat'));

        // 5. Live Typing Analysis
        const liveSafe = await request('/api/analyze-live', 'POST', { message: 'Great job on the presentation today!' });
        assert('Live analysis flags safe message with low risk', liveSafe.status === 200 && liveSafe.data.blocked === false && liveSafe.data.bullying_probability < 0.2);

        const liveBullying = await request('/api/analyze-live', 'POST', { message: 'You are a pathetic idiot loser, delete your account.' });
        assert('Live analysis flags toxic message with high risk and extract terms', liveBullying.status === 200 && liveBullying.data.blocked === true && liveBullying.data.bullying_probability >= 0.77);
        assert('Live analysis extracts flagged terms', liveBullying.data.flagged_terms && liveBullying.data.flagged_terms.length > 0);

        // 6. Message Dispatch: Safe message from User 1 (Alex)
        const sendSafe1 = await request('/api/send', 'POST', {
            sender: 'User 1',
            message: 'Hello Jordan, are you coming to class today?'
        });
        assert('Send safe message from User 1 succeeds', sendSafe1.status === 200 && sendSafe1.data.blocked === false);

        // 7. Message Dispatch: Safe reply from User 2 (Jordan)
        const sendSafe2 = await request('/api/send', 'POST', {
            sender: 'User 2',
            message: 'Yes, I will be there at 2pm!'
        });
        assert('Send safe message from User 2 succeeds', sendSafe2.status === 200 && sendSafe2.data.blocked === false);

        // 8. Message Dispatch: Cyberbullying Message (Blocked)
        const sendBullying = await request('/api/send', 'POST', {
            sender: 'User 1',
            message: 'Nobody likes you, you worthless loser, go die!'
        });
        assert('Cyberbullying message is blocked by moderator', sendBullying.status === 200 && sendBullying.data.blocked === true);

        // 9. Chat Stream Verification (Only Safe Messages Visible)
        const messages = await request('/api/messages');
        assert('Only safe messages are visible in chat stream (count = 2)', messages.status === 200 && messages.data.length === 2);
        const containsBlocked = messages.data.some(m => m.message.includes('worthless loser'));
        assert('Blocked cyberbullying message is NOT in chat stream', !containsBlocked);

        // 10. Admin Stats Verification
        const stats = await request('/api/admin/stats');
        assert('Admin stats: total_messages is 3', stats.data.total_messages === 3);
        assert('Admin stats: safe_messages is 2', stats.data.safe_messages === 2);
        assert('Admin stats: flagged_messages is 1', stats.data.flagged_messages === 1);
        assert('Admin stats: pending_alerts is 1', stats.data.pending_alerts === 1);

        // 11. Admin Alerts Verification
        const alerts = await request('/api/admin/alerts');
        assert('Admin alerts has 1 incident in queue', alerts.status === 200 && alerts.data.length === 1);
        assert('Alert sender is User 1 and status is Pending', alerts.data[0].sender === 'User 1' && alerts.data[0].status === 'Pending');

        // 12. Review Alert Action
        const alertId = alerts.data[0].alert_id;
        const review = await request(`/api/admin/alerts/${alertId}/review`, 'POST', { action: 'Reviewed' });
        assert('Alert can be marked Reviewed', review.status === 200 && review.data.status === 'Reviewed');

        const updatedAlerts = await request('/api/admin/alerts');
        assert('Updated alert status is Reviewed in database', updatedAlerts.data[0].status === 'Reviewed');

        // 13. CSV Export Verification
        const csv = await request('/api/admin/export');
        assert('CSV export returns 200 with text/csv content', csv.status === 200 && csv.data.includes('Alert ID,Status,Sender,Message'));

        console.log(`\n========================================`);
        console.log(`Summary: ${passCount} / ${totalCount} tests passed!`);
        console.log(`========================================\n`);

    } catch (e) {
        console.error('Test execution failed with error:', e);
    }
}

runTests();
