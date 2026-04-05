/**
 * SANAD Chatbot UI Logic
 * Handles message rendering, sending, and chat history.
 * Integrated with CareCompanion AI (ngrok) for Chat and TTS.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const user = requireAuth();
    if (!user) return;

    // Check AI server status immediately
    checkServerStatus();

    // Load existing chat history
    await loadHistory();
});

async function checkServerStatus() {
    const banner = document.getElementById('serverStatus');
    const dot = banner.querySelector('.status-dot');
    try {
        const res = await fetch('https://unslakable-unplacid-anton.ngrok-free.dev/', { mode: 'no-cors' });
        banner.className = 'status-banner';
        banner.innerHTML = `<div class="status-dot"></div> سند متصل وجاهز للمساعدة ✅`;
    } catch (err) {
        banner.className = 'status-banner offline';
        banner.innerHTML = `<div class="status-dot"></div> سند غير متصل حالياً ❌`;
    }
}

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

// ─── Voice Logic (STT & TTS & Recording) ──────────────────────────────────────
let isVoiceEnabled = true;
let currentAudio = null;
let isRecording = false;
let recognition = null;
let mediaRecorder = null;
let audioChunks = [];
const voiceMessagesMap = new Map();

if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ar-EG';

    recognition.onstart = async () => {
        isRecording = true;
        document.getElementById('micBtn').classList.add('recording');
        document.getElementById('micBtn').title = 'اضغط للإيقاف والإرسال';
        
        // Start recording raw audio
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                const audioUrl = URL.createObjectURL(audioBlob);
                const content = document.getElementById('chatInput').value.trim() || '[رسالة صوتية]';
                
                // Finalize sending with both text and audio
                finalizeMessage(content, audioUrl);
                document.getElementById('chatInput').value = '';
                autoResize(document.getElementById('chatInput'));
            };
            mediaRecorder.start();
        } catch (err) { console.error('MediaRecorder error:', err); }
    };

    recognition.onend = () => {
        if (!isRecording) {
            document.getElementById('micBtn').classList.remove('recording');
            document.getElementById('micBtn').title = 'تحدث لسند';
        } else {
            try { recognition.start(); } catch(e) {}
        }
    };

    recognition.onresult = (event) => {
        let finalResult = '';
        let interimResult = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalResult += event.results[i][0].transcript;
            } else {
                interimResult += event.results[i][0].transcript;
            }
        }
        document.getElementById('chatInput').value = (document.getElementById('chatInput').dataset.prev || '') + finalResult + interimResult;
        autoResize(document.getElementById('chatInput'));

        if (finalResult) {
            document.getElementById('chatInput').dataset.prev = (document.getElementById('chatInput').dataset.prev || '') + finalResult + ' ';
        }
    };
}

function toggleSTT() {
    if (!recognition) {
        showToast('متصفحك لا يدعم خاصية التحدث', 'error');
        return;
    }
    if (isRecording) {
        isRecording = false;
        recognition.stop();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    } else {
        document.getElementById('chatInput').dataset.prev = '';
        recognition.start();
    }
}

async function finalizeMessage(content, userAudioUrl = null) {
    // Re-verify server status before sending attempt
    await checkServerStatus();
    const banner = document.getElementById('serverStatus');
    if (banner.classList.contains('offline')) {
        showToast('لا يمكن التواصل مع سند حالياً، السيرفر غير متصل ❌', 'error');
        return;
    }

    appendMessage(content, 'user', new Date().toISOString(), true, userAudioUrl);
    showTyping();

    const btn = document.getElementById('sendBtn');
    btn.disabled = true;

    try {
        const data = await api.chat.send(content);
        let botAudioUrl = null;

        if (isVoiceEnabled) {
            try {
                const res = await fetch('https://unslakable-unplacid-anton.ngrok-free.dev/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: data.botMessage.content })
                });
                if (res.ok) {
                    const blob = await res.blob();
                    botAudioUrl = URL.createObjectURL(blob);
                }
            } catch (err) { console.error('TTS error:', err); }
        }

        hideTyping();
        appendMessage(data.botMessage.content, 'bot', data.botMessage.createdAt, true, botAudioUrl);
    } catch (err) {
        hideTyping();
        appendMessage('عفواً، حصل خطأ. حاول تاني! 😔', 'bot', new Date().toISOString());
    } finally {
        btn.disabled = false;
        document.getElementById('chatInput').focus();
    }
}

function toggleVoice() {
    isVoiceEnabled = !isVoiceEnabled;
    const btn = document.getElementById('voiceToggle');
    btn.innerText = isVoiceEnabled ? '🔊' : '🔇';
    if (!isVoiceEnabled && currentAudio) currentAudio.pause();
}

// ─── Send Message ─────────────────────────────────────────────────────────────
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';
    autoResize(input);

    finalizeMessage(content);
}

function sendQuick(text) {
    finalizeMessage(text);
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function appendMessage(content, role, timestamp, scroll = true, audioUrl = null) {
    const container = document.getElementById('chatMessages');
    const timeStr = formatTime(timestamp);
    const msgId = 'msg-' + Date.now() + Math.random().toString(36).substr(2, 5);

    const div = document.createElement('div');
    div.className = `message ${role} animate-fade-in`;
    div.id = msgId;

    let audioHtml = '';
    if (audioUrl) {
        audioHtml = `
      <div class="audio-player" id="player-${msgId}">
        <div class="audio-controls" onclick="togglePlayPause('${msgId}', '${audioUrl}')">▶</div>
        <div class="audio-progress-container" onclick="seekAudio(event, '${msgId}')">
          <div class="audio-progress-bar" id="progress-${msgId}"></div>
        </div>
        <div class="audio-time" id="time-${msgId}">0:00</div>
      </div>
    `;
    }

    div.innerHTML = `
    <div class="message-bubble">
      ${escapeHtml(content)}
      ${audioHtml}
    </div>
    <div class="message-time">${timeStr}</div>
  `;

    container.appendChild(div);
    if (scroll) scrollToBottom();

    if (audioUrl && isVoiceEnabled) {
        setTimeout(() => togglePlayPause(msgId, audioUrl), 300);
    }
}

function togglePlayPause(msgId, url) {
    let audio = voiceMessagesMap.get(msgId);
    const btn = document.querySelector(`#player-${msgId} .audio-controls`);
    const progress = document.getElementById(`progress-${msgId}`);
    const timeDisplay = document.getElementById(`time-${msgId}`);

    if (!audio) {
        audio = new Audio(url);
        voiceMessagesMap.set(msgId, audio);

        audio.addEventListener('loadedmetadata', () => {
            // Force duration calculation hack
            if (audio.duration === Infinity) {
                audio.currentTime = 1e101;
                audio.ontimeupdate = function() {
                    this.ontimeupdate = () => {
                        if (audio.duration && audio.duration !== Infinity) {
                            const pct = (audio.currentTime / audio.duration) * 100;
                            progress.style.width = pct + '%';
                            timeDisplay.innerText = formatDuration(audio.currentTime);
                        } else {
                            timeDisplay.innerText = formatDuration(audio.currentTime);
                        }
                    };
                    audio.currentTime = 0;
                    if (audio.duration && audio.duration !== Infinity) {
                        timeDisplay.innerText = formatDuration(audio.duration);
                    }
                };
            } else if (audio.duration) {
                timeDisplay.innerText = formatDuration(audio.duration);
            }
        });

        audio.onended = () => {
            btn.innerText = '▶';
            progress.style.width = '0%';
            if (audio.duration && audio.duration !== Infinity) {
                timeDisplay.innerText = formatDuration(audio.duration);
            }
        };
    }

    if (audio.paused) {
        // Pause others
        voiceMessagesMap.forEach((a, id) => { 
            if (id !== msgId) { 
                a.pause(); 
                const otherBtn = document.querySelector(`#player-${id} .audio-controls`);
                if(otherBtn) otherBtn.innerText = '▶'; 
            } 
        });
        audio.play();
        btn.innerText = '⏸';
        currentAudio = audio;
    } else {
        audio.pause();
        btn.innerText = '▶';
    }
}

function seekAudio(event, msgId) {
    const audio = voiceMessagesMap.get(msgId);
    if (!audio) return;
    const container = event.currentTarget;
    const pct = event.offsetX / container.offsetWidth;
    audio.currentTime = pct * audio.duration;
}

function formatDuration(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
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
