/**
 * AI Cyberbullying Incident Monitor - Admin & Analytics Engine
 */

(() => {
    // DOM Elements
    const totalMessages = document.getElementById('totalMessages');
    const safeMessages = document.getElementById('safeMessages');
    const flaggedMessages = document.getElementById('flaggedMessages');
    const pendingAlerts = document.getElementById('pendingAlerts');
    const safetyRateText = document.getElementById('safetyRateText');
    const detectionRateText = document.getElementById('detectionRateText');
    const activityChart = document.getElementById('activityChart');
    const alertsGrid = document.getElementById('alertsGrid');
    const refreshBtn = document.getElementById('refreshBtn');
    const clearDataBtn = document.getElementById('clearDataBtn');
    const filterBtns = document.querySelectorAll('.filter-btn');

    // Model Hub Elements
    const modelEngineBadge = document.getElementById('modelEngineBadge');
    const modelEngineText = document.getElementById('modelEngineText');
    const uploadDropzone = document.getElementById('uploadDropzone');
    const modelFileInput = document.getElementById('modelFileInput');
    const metaEngine = document.getElementById('metaEngine');
    const metaArch = document.getElementById('metaArch');
    const metaF1 = document.getElementById('metaF1');
    const metaAcc = document.getElementById('metaAcc');

    const required = [
        totalMessages,
        safeMessages,
        flaggedMessages,
        pendingAlerts,
        safetyRateText,
        detectionRateText,
        activityChart,
        alertsGrid,
        refreshBtn,
        clearDataBtn,
        modelEngineBadge,
        modelEngineText,
        uploadDropzone,
        modelFileInput,
        metaEngine,
        metaArch,
        metaF1,
        metaAcc,
    ];

    if (required.some((element) => !element)) {
        console.warn('Admin UI is missing required elements; admin initialization was skipped to avoid null-property crashes.');
        return;
    }

    // State
    let currentFilter = 'all';

    // Time formatting helper
    function formatTime(val) {
        if (!val) return '';
        try {
            const normalized = val.includes('T') ? val : val.replace(' ', 'T') + 'Z';
            const d = new Date(normalized);
            if (Number.isNaN(d.getTime())) return val;
            return d.toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch {
            return val;
        }
    }

    // 1. Fetch & Render KPI Stats & Dynamic Activity Chart
    async function loadStats() {
        try {
            const res = await fetch('/api/admin/stats');
            if (!res.ok) return;
            const data = await res.json();

            totalMessages.textContent = data.total_messages.toLocaleString();
            safeMessages.textContent = data.safe_messages.toLocaleString();
            flaggedMessages.textContent = data.flagged_messages.toLocaleString();
            pendingAlerts.textContent = data.pending_alerts.toLocaleString();

            safetyRateText.textContent = `${data.safety_index}% system safety rate`;
            detectionRateText.textContent = `${data.detection_rate}% detection rate`;

            renderActivityChart(data.recent_activity || []);
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    }

    // 2. Render Dynamic Activity Bar Chart
    function renderActivityChart(activity) {
        activityChart.replaceChildren();

        if (!activity.length) {
            activityChart.innerHTML = `
                <div style="margin: auto; color: var(--text-muted); font-size: 13px;">
                    No message volume recorded yet. Send messages from the Safe Chat to generate analytics.
                </div>
            `;
            return;
        }

        activity.forEach((item) => {
            const col = document.createElement('div');
            col.className = 'chart-bar-col';

            const fill = document.createElement('div');
            fill.className = `chart-bar-fill ${item.blocked ? 'blocked' : 'safe'}`;

            const prob = item.bullying_probability || (item.blocked ? 0.85 : 0.05);
            const heightPct = Math.max(15, Math.min(100, Math.round(prob * 100)));
            fill.style.height = `${heightPct}%`;
            fill.title = `${item.sender}: ${Math.round(prob * 100)}% risk (${item.blocked ? 'BLOCKED' : 'SAFE'})`;

            const label = document.createElement('span');
            label.className = 'chart-bar-label';
            label.textContent = `#${item.id}`;

            col.append(fill, label);
            activityChart.appendChild(col);
        });
    }

    // 3. Highlight offensive terms inside alert message
    function highlightText(text, flaggedTerms) {
        if (!text) return '';
        let escaped = String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#039;');
        if (flaggedTerms && Array.isArray(flaggedTerms)) {
            flaggedTerms.forEach(term => {
                if (!term) return;
                const safeTerm = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${safeTerm})`, 'gi');
                escaped = escaped.replace(regex, '<mark class="flagged-high">$1</mark>');
            });
        }
        return escaped;
    }

    // 4. Fetch & Render Incident Alerts
    async function loadAlerts() {
        try {
            const res = await fetch(`/api/admin/alerts?status=${encodeURIComponent(currentFilter)}`);
            if (!res.ok) return;
            const alerts = await res.json();

            alertsGrid.replaceChildren();

            if (!alerts.length) {
                alertsGrid.innerHTML = `
                    <div class="empty-chat-state" style="padding: 40px 0;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <h3>No Incidents Found</h3>
                        <p>No messages match the active "${currentFilter}" filter.</p>
                    </div>
                `;
                return;
            }

            alerts.forEach(alert => {
                const card = document.createElement('article');
                const statusLower = (alert.status || 'Pending').toLowerCase();
                card.className = `incident-card ${statusLower}`;

                const top = document.createElement('div');
                top.className = 'incident-top';

                const senderInfo = document.createElement('div');
                senderInfo.innerHTML = `
                    <strong style="color: #f8fafc;">${alert.sender}</strong>
                    <span style="color: var(--text-muted); font-size: 12px; margin-left: 8px;">${formatTime(alert.alert_created_at)}</span>
                `;

                const badge = document.createElement('span');
                badge.className = `incident-badge ${statusLower}`;
                badge.textContent = alert.status;

                top.append(senderInfo, badge);

                const textBox = document.createElement('div');
                textBox.className = 'incident-text-box';
                textBox.innerHTML = highlightText(alert.message, alert.flagged_terms);

                const metaRow = document.createElement('div');
                metaRow.className = 'incident-meta-row';

                const probPct = Math.round((alert.bullying_probability || alert.confidence || 0) * 100);
                const detailText = document.createElement('span');
                detailText.innerHTML = `Category: <strong>${alert.category || 'Harassment'}</strong> • Risk: <strong style="color: var(--danger);">${probPct}%</strong>`;

                const actions = document.createElement('div');
                actions.className = 'incident-actions';

                if (alert.status === 'Pending') {
                    const btnConfirm = document.createElement('button');
                    btnConfirm.className = 'action-btn-sm confirm';
                    btnConfirm.textContent = 'Mark Reviewed';
                    btnConfirm.addEventListener('click', () => updateAlertStatus(alert.alert_id, 'Reviewed'));

                    const btnDismiss = document.createElement('button');
                    btnDismiss.className = 'action-btn-sm';
                    btnDismiss.textContent = 'Dismiss';
                    btnDismiss.addEventListener('click', () => updateAlertStatus(alert.alert_id, 'Dismiss'));

                    actions.append(btnConfirm, btnDismiss);
                } else {
                    const reviewedTime = document.createElement('span');
                    reviewedTime.style.color = 'var(--text-muted)';
                    reviewedTime.style.fontSize = '11px';
                    reviewedTime.textContent = alert.reviewed_at ? `Audit: ${formatTime(alert.reviewed_at)}` : 'Audited';
                    actions.appendChild(reviewedTime);
                }

                metaRow.append(detailText, actions);
                card.append(top, textBox, metaRow);
                alertsGrid.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load alerts:', err);
        }
    }

    // 5. Update Alert Status
    async function updateAlertStatus(alertId, action) {
        try {
            const res = await fetch(`/api/admin/alerts/${alertId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            if (res.ok) {
                await Promise.all([loadStats(), loadAlerts()]);
            }
        } catch (e) {
            alert('Could not update alert: ' + e.message);
        }
    }

    // 6. Fetch Model Engine Info
    async function loadModelInfo() {
        try {
            const res = await fetch('/api/model/info');
            if (!res.ok) return;
            const data = await res.json();

            if (data.model_ready) {
                modelEngineBadge.className = 'status-pill online';
                modelEngineText.textContent = 'Colab Pipeline Connected';
                metaEngine.textContent = 'Colab Trained ML Pipeline';

                if (data.metadata) {
                    if (data.metadata.f1) metaF1.textContent = `${(data.metadata.f1 * 100).toFixed(1)}%`;
                    if (data.metadata.accuracy) metaAcc.textContent = `${(data.metadata.accuracy * 100).toFixed(1)}%`;
                    if (data.metadata.model) metaArch.textContent = data.metadata.model;
                }
            } else {
                modelEngineBadge.className = 'status-pill baseline';
                modelEngineText.textContent = 'Baseline Heuristic Active (Colab Pending)';
                metaEngine.textContent = 'Baseline Heuristic Engine';
                metaF1.textContent = 'Waiting for Colab Export';
                metaAcc.textContent = 'Waiting for Colab Export';
            }
        } catch (e) {
            console.warn('Model info error:', e);
        }
    }

    // 7. Colab Model Upload Hub (Drag & Drop + File Selector)
    uploadDropzone.addEventListener('click', () => modelFileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            uploadDropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            uploadDropzone.classList.remove('dragover');
        });
    });

    uploadDropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length) uploadModelFile(files[0]);
    });

    modelFileInput.addEventListener('change', () => {
        if (modelFileInput.files.length) {
            uploadModelFile(modelFileInput.files[0]);
        }
    });

    async function uploadModelFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        const originalText = uploadDropzone.querySelector('p').innerHTML;
        uploadDropzone.querySelector('p').innerHTML = `<strong>Uploading & Hot-Reloading ${file.name}...</strong>`;

        try {
            const res = await fetch('/api/model/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (res.ok) {
                alert(data.message || 'Model uploaded and reloaded successfully!');
                await loadModelInfo();
                await loadStats();
            } else {
                alert('Upload failed: ' + (data.error || 'Unknown error'));
            }
        } catch (e) {
            alert('Upload failed: ' + e.message);
        } finally {
            uploadDropzone.querySelector('p').innerHTML = originalText;
            modelFileInput.value = '';
        }
    }

    // 8. Filter Tabs Listener
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            loadAlerts();
        });
    });

    // 9. Clear Demo Data Handler
    clearDataBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to reset all demo messages and moderation alerts?')) return;
        try {
            const res = await fetch('/api/admin/clear', { method: 'POST' });
            if (res.ok) {
                await Promise.all([loadStats(), loadAlerts()]);
                alert('Demo data cleared.');
            }
        } catch (e) {
            alert('Error clearing data: ' + e.message);
        }
    });

    refreshBtn.addEventListener('click', () => {
        loadStats();
        loadAlerts();
        loadModelInfo();
    });

    // Initial Load & Auto-Poll
    loadModelInfo();
    loadStats();
    loadAlerts();
    setInterval(loadStats, 5000);
    setInterval(loadAlerts, 5000);
})();
