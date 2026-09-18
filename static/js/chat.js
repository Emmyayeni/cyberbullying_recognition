/** Community Chat: real-time anonymous room UI. */

const chatWindow = document.getElementById('chatWindow');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const charCount = document.getElementById('charCount');
const resultToast = document.getElementById('resultToast');
const toastTitle = document.getElementById('toastTitle');
const toastMessage = document.getElementById('toastMessage');
const identityAvatar = document.getElementById('identityAvatar');
const newIdentityBtn = document.getElementById('newIdentityBtn');
const currentUserLabel = document.getElementById('currentUserLabel');
const onlineCount = document.getElementById('onlineCount');
const memberCountLabel = document.getElementById('memberCountLabel');
const memberList = document.getElementById('memberList');
const replyContext = document.getElementById('replyContext');
const replyContextAvatar = document.getElementById('replyContextAvatar');
const replyContextAuthor = document.getElementById('replyContextAuthor');
const replyContextText = document.getElementById('replyContextText');
const cancelReplyBtn = document.getElementById('cancelReplyBtn');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const topicDismissBtn = document.getElementById('topicDismissBtn');
const chatTopic = document.querySelector('.chat-topic');

function createGuestName() {
    const random = window.crypto?.getRandomValues
        ? window.crypto.getRandomValues(new Uint32Array(1))[0]
        : Math.floor(Math.random() * 900000);
    return `Guest-${1000 + (random % 9000)}`;
}

let displayName = localStorage.getItem('safeChatGuestName') || createGuestName();
let replyToId = null;
let isSubmitting = false;
let renderedMessages = [];
let toastTimer = null;
let liveStream = null;

function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
        .map(part => part[0]).join('').toUpperCase();
}

function avatarColor(name) {
    const palette = ['#5865f2', '#3ba55d', '#eb459e', '#f0b232', '#00a8fc', '#9b59b6'];
    const hash = [...String(name)].reduce((total, character) => total + character.charCodeAt(0), 0);
    return palette[hash % palette.length];
}

function setAnonymousIdentity(name) {
    displayName = name;
    localStorage.setItem('safeChatGuestName', name);
    identityAvatar.textContent = initials(name);
    identityAvatar.style.background = avatarColor(name);
    currentUserLabel.textContent = `You are ${name}`;
    connectLiveChat();
    loadMessages(false);
    updateComposerState();
    messageInput.focus();
}

function formatTime(value) {
    if (!value) return '';
    try {
        const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return value;
    }
}

function isGroupedWithPrevious(item, previousItem) {
    if (!previousItem || previousItem.sender !== item.sender || item.reply_to_id) return false;
    const currentTime = new Date(item.created_at).getTime();
    const previousTime = new Date(previousItem.created_at).getTime();
    return Number.isFinite(currentTime) && Number.isFinite(previousTime)
        ? currentTime - previousTime < 5 * 60 * 1000
        : true;
}

function createBubble(item, previousItem = null) {
    const isMine = item.sender === displayName;
    const grouped = isGroupedWithPrevious(item, previousItem);
    const article = document.createElement('article');
    article.className = `message-bubble${isMine ? ' mine' : ''}${grouped ? ' grouped' : ''}`;
    article.dataset.messageId = item.id;

    const avatar = document.createElement('div');
    avatar.className = 'bubble-avatar avatar';
    avatar.textContent = initials(item.sender);
    avatar.style.background = avatarColor(item.sender);
    avatar.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'bubble-content';

    if (!grouped) {
        const header = document.createElement('div');
        header.className = 'bubble-header';
        const author = document.createElement('span');
        author.className = 'bubble-author';
        author.textContent = isMine ? `${item.sender} · You` : item.sender;
        const time = document.createElement('time');
        time.className = 'bubble-time';
        time.dateTime = item.created_at || '';
        time.textContent = formatTime(item.created_at);
        header.append(author, time);
        content.appendChild(header);
    } else {
        const compactTime = document.createElement('time');
        compactTime.className = 'compact-time';
        compactTime.dateTime = item.created_at || '';
        compactTime.textContent = formatTime(item.created_at);
        article.appendChild(compactTime);
    }

    if (item.reply_to_id && item.reply_to_sender) {
        const replyPreview = document.createElement('button');
        replyPreview.type = 'button';
        replyPreview.className = 'message-reply';
        replyPreview.setAttribute('aria-label', `Go to ${item.reply_to_sender}'s original message`);

        const replyAvatar = document.createElement('span');
        replyAvatar.className = 'message-reply-avatar';
        replyAvatar.textContent = initials(item.reply_to_sender);
        replyAvatar.style.background = avatarColor(item.reply_to_sender);

        const replyAuthor = document.createElement('strong');
        replyAuthor.textContent = item.reply_to_sender;

        const replyText = document.createElement('span');
        replyText.textContent = item.reply_to_message || 'Original message';

        replyPreview.append(replyAvatar, replyAuthor, replyText);
        replyPreview.addEventListener('click', () => scrollToMessage(item.reply_to_id));
        content.appendChild(replyPreview);
    }

    const text = document.createElement('p');
    text.className = 'bubble-text';
    text.textContent = item.message;
    content.appendChild(text);

    const replyButton = document.createElement('button');
    replyButton.type = 'button';
    replyButton.className = 'reply-btn';
    replyButton.textContent = 'Reply';
    replyButton.setAttribute('aria-label', `Reply to ${item.sender}`);
    replyButton.addEventListener('click', () => beginReply(item));
    content.appendChild(replyButton);

    article.append(avatar, content);
    return article;
}

function beginReply(item) {
    replyToId = item.id;
    replyContext.classList.remove('hidden');
    const preview = item.message.length > 70 ? `${item.message.slice(0, 70)}…` : item.message;
    replyContextAvatar.textContent = initials(item.sender);
    replyContextAvatar.style.background = avatarColor(item.sender);
    replyContextAuthor.textContent = `Replying to ${item.sender}`;
    replyContextText.textContent = preview;
    messageInput.focus();
}

function clearReply() {
    replyToId = null;
    replyContext.classList.add('hidden');
    replyContextAuthor.textContent = 'Replying to a message';
    replyContextText.textContent = 'Select a message to reply';
}

function scrollToMessage(messageId) {
    const target = chatWindow.querySelector(`[data-message-id="${messageId}"]`);
    if (!target) {
        showToast('error', 'Original unavailable', 'That message is outside the recent chat history.');
        return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('reply-highlight');
    void target.offsetWidth;
    target.classList.add('reply-highlight');
    window.setTimeout(() => target.classList.remove('reply-highlight'), 1600);
}

function renderMessages(messages, preserveScroll = true) {
    const wasNearBottom = chatWindow.scrollHeight - chatWindow.scrollTop <= chatWindow.clientHeight + 80;
    const previousScrollHeight = chatWindow.scrollHeight;
    const previousScrollTop = chatWindow.scrollTop;
    chatWindow.replaceChildren();
    messages.forEach((message, index) => {
        chatWindow.appendChild(createBubble(message, messages[index - 1]));
    });
    renderedMessages = messages;

    if (!preserveScroll || wasNearBottom) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    } else {
        chatWindow.scrollTop = previousScrollTop + (chatWindow.scrollHeight - previousScrollHeight);
    }
}

async function loadMessages(forceScroll = false) {
    try {
        const response = await fetch('/api/messages');
        if (!response.ok) throw new Error('Messages are temporarily unavailable.');
        const messages = await response.json();

        if (!messages.length) {
            chatWindow.innerHTML = `
                <div class="empty-chat-state">
                    <div class="empty-chat-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </div>
                    <h3>The room is ready</h3>
                    <p>Start a friendly conversation. Messages shared here are visible to everyone in the room.</p>
                </div>`;
            renderedMessages = [];
            return;
        }

        const latestId = messages[messages.length - 1]?.id;
        const renderedLatestId = renderedMessages[renderedMessages.length - 1]?.id;
        if (messages.length !== renderedMessages.length || latestId !== renderedLatestId) {
            renderMessages(messages, !forceScroll);
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function renderMembers(members) {
    const names = Array.from(new Set((members || []).filter(Boolean)));
    memberList.replaceChildren();
    if (!names.length) names.push(displayName);

    names.forEach(name => {
        const row = document.createElement('div');
        row.className = 'member-row';
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = initials(name);
        avatar.style.background = avatarColor(name);
        const copy = document.createElement('span');
        copy.className = 'member-name';
        copy.textContent = name === displayName ? `${name} (you)` : name;
        row.append(avatar, copy);
        memberList.appendChild(row);
    });
}

function updatePresence(event) {
    try {
        const data = JSON.parse(event.data || '{}');
        const count = Math.max(1, Number(data.online) || 1);
        onlineCount.textContent = `${count} ${count === 1 ? 'person' : 'people'} online`;
        memberCountLabel.textContent = count;
        renderMembers(data.members);
    } catch (error) {
        console.warn('Presence update unavailable:', error);
    }
}

function connectLiveChat() {
    liveStream?.close();
    if (!window.EventSource) return;
    liveStream = new EventSource(`/api/events?name=${encodeURIComponent(displayName)}`);
    liveStream.addEventListener('message', () => loadMessages(false));
    liveStream.addEventListener('ready', updatePresence);
    liveStream.addEventListener('presence', updatePresence);
}

function autoGrowComposer() {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 160)}px`;
}

function updateComposerState() {
    const length = messageInput.value.length;
    charCount.textContent = `${length} / 1000`;
    charCount.classList.toggle('near-limit', length >= 900);
    charCount.classList.toggle('at-limit', length >= 980);
    sendButton.disabled = !messageInput.value.trim() || isSubmitting;
    autoGrowComposer();
}

function showToast(type, title, message) {
    clearTimeout(toastTimer);
    resultToast.classList.remove('hidden', 'blocked', 'allowed', 'error');
    resultToast.classList.add(type);
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toastTimer = setTimeout(() => resultToast.classList.add('hidden'), 2200);
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isSubmitting) return;
    isSubmitting = true;
    sendButton.setAttribute('aria-busy', 'true');
    updateComposerState();

    try {
        const response = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: displayName, message: text, reply_to_id: replyToId })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Message could not be sent.');

        if (data.blocked) {
            showToast('blocked', 'Message blocked', 'It was not shared with the room.');
        } else {
            showToast('allowed', 'Sent', 'Your message was delivered.');
        }

        messageInput.value = '';
        clearReply();
        updateComposerState();
        if (!data.blocked) await loadMessages(true);
    } catch (error) {
        showToast('error', 'Could not send', error.message);
    } finally {
        isSubmitting = false;
        sendButton.removeAttribute('aria-busy');
        updateComposerState();
        messageInput.focus();
    }
}

function closeMobileNavigation() {
    document.body.classList.remove('mobile-nav-open');
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
}

messageInput.addEventListener('input', updateComposerState);
messageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});
messageForm.addEventListener('submit', event => {
    event.preventDefault();
    sendMessage();
});
cancelReplyBtn.addEventListener('click', clearReply);
newIdentityBtn.addEventListener('click', () => setAnonymousIdentity(createGuestName()));
mobileMenuBtn.addEventListener('click', () => {
    const open = document.body.classList.toggle('mobile-nav-open');
    mobileMenuBtn.setAttribute('aria-expanded', String(open));
});
sidebarBackdrop.addEventListener('click', closeMobileNavigation);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMobileNavigation();
});
topicDismissBtn.addEventListener('click', () => {
    chatTopic.classList.add('hidden');
    localStorage.setItem('safeChatTopicDismissed', 'true');
});

if (localStorage.getItem('safeChatTopicDismissed') === 'true') chatTopic.classList.add('hidden');
setAnonymousIdentity(displayName);
loadMessages(true);
updateComposerState();
setInterval(() => loadMessages(false), 15000);
