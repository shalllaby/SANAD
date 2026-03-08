/**
 * SANAD Chatbot UI Logic
 * Handles message rendering, sending, and chat history.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const user = requireAuth();
    if (!user) return;

    // Load existing chat history
    await loadHistory();

    document.getElementById('chatInput').focus();
});

// ─── Load History ─────────────────────────────────────────────────────────────
async function loadHistory() {
    try {
        const data = await api.chat.history(30);
        const messages = data.messages || [];
        if (messages.length > 0) {
            messages.forEach(m => appendMessage(m.content, m.role === 'USER' ? 'user' : 'bot', m.createdAt, false));
            scrollToBottom();
        }
    } catch (err) {
        console.error('History error:', err);
    }
}

// ─── Send Message ─────────────────────────────────────────────────────────────
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';
    autoResize(input);

    appendMessage(content, 'user', new Date().toISOString());
    showTyping();

    const btn = document.getElementById('sendBtn');
    btn.disabled = true;

    try {
        const data = await api.chat.send(content);
        hideTyping();
        appendMessage(data.botMessage.content, 'bot', data.botMessage.createdAt);
    } catch (err) {
        hideTyping();
        appendMessage('عفواً، حصل خطأ. حاول تاني! 😔', 'bot', new Date().toISOString());
    } finally {
        btn.disabled = false;
        input.focus();
    }
}

function sendQuick(text) {
    document.getElementById('chatInput').value = text;
    sendMessage();
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function appendMessage(content, role, timestamp, scroll = true) {
    const container = document.getElementById('chatMessages');
    const timeStr = formatTime(timestamp);

    const div = document.createElement('div');
    div.className = `message ${role} animate-fade-in`;
    div.innerHTML = `
    <div class="message-bubble">${escapeHtml(content)}</div>
    <div class="message-time">${timeStr}</div>
  `;
    container.appendChild(div);
    if (scroll) scrollToBottom();
}

function showTyping() {
    const container = document.getElementById('chatMessages');
    const typing = document.createElement('div');
    typing.className = 'message bot animate-fade-in';
    typing.id = 'typingIndicator';
    typing.innerHTML = `
    <div class="message-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
    container.appendChild(typing);
    scrollToBottom();
}

function hideTyping() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
}

function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ─── Keyboard Handling ────────────────────────────────────────────────────────
function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
