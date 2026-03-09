const API_URL = '/oncall-os-api';

// ==================== Gemini Live Voice ====================

let recognition = null;
let isListening = false;
let currentUtterance = null;
let screenStream = null;
let screenContext = null;
let sessionId = null;
let screenVideoElement = null;
let screenCanvas = null;

// Initialize speech recognition
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Web Speech API not supported in this browser. Try Chrome or Edge.');
        return null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
        isListening = true;
        updateVoiceStatus('listening', '🎤 Listening...');
        document.getElementById('micBtn').textContent = '⏹️ Stop Mic';
        document.getElementById('micBtn').classList.add('stop');
    };

    rec.onend = () => {
        isListening = false;
        updateVoiceStatus('ready', 'Ready to start');
        document.getElementById('micBtn').textContent = '🎙️ Start Mic';
        document.getElementById('micBtn').classList.remove('stop');
    };

    rec.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Update transcript display
        const transcriptText = document.getElementById('transcriptText');
        if (finalTranscript) {
            transcriptText.textContent = finalTranscript;
            transcriptText.classList.remove('interim');
            // Send to Gemini
            sendToGemini(finalTranscript);
        } else if (interimTranscript) {
            transcriptText.textContent = interimTranscript;
            transcriptText.classList.add('interim');
        }
    };

    rec.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        updateVoiceStatus('error', 'Error: ' + event.error);
        stopListening();
    };

    return rec;
}

function updateVoiceStatus(state, message) {
    const status = document.getElementById('voiceStatus');
    status.textContent = message;
    status.className = 'voice-status';
    if (state === 'listening') status.classList.add('active');
    if (state === 'speaking') status.classList.add('speaking');
}

async function toggleMic() {
    if (isListening) {
        stopListening();
    } else {
        await startListening();
    }
}

async function startListening() {
    // Initialize session first
    if (!sessionId) {
        try {
            const response = await fetch(`${API_URL}/gemini/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'voice' })
            });
            const data = await response.json();
            if (data.error) {
                alert(data.error);
                return;
            }
            sessionId = data.sessionId;
            console.log('Gemini session initialized:', sessionId);
        } catch (err) {
            alert('Failed to initialize Gemini session: ' + err.message);
            return;
        }
    }

    if (!recognition) {
        recognition = initSpeechRecognition();
    }

    if (recognition) {
        try {
            recognition.start();
        } catch (err) {
            console.error('Failed to start recognition:', err);
        }
    }
}

function stopListening() {
    if (recognition) {
        recognition.stop();
    }
    // Cancel any ongoing speech
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
}

// Interrupt behavior: new utterance cancels current speech output
function speak(text) {
    if (!window.speechSynthesis) {
        console.log('Speech synthesis not supported');
        return;
    }

    // Cancel any ongoing speech (interrupt behavior)
    window.speechSynthesis.cancel();

    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.rate = 1.0;
    currentUtterance.pitch = 1.0;
    currentUtterance.volume = 1.0;

    currentUtterance.onstart = () => {
        updateVoiceStatus('speaking', '🔊 Speaking...');
    };

    currentUtterance.onend = () => {
        if (isListening) {
            updateVoiceStatus('listening', '🎤 Listening...');
        } else {
            updateVoiceStatus('ready', 'Ready to start');
        }
    };

    window.speechSynthesis.speak(currentUtterance);
}

async function sendToGemini(text) {
    updateVoiceStatus('thinking', '🤔 Processing...');

    try {
        const response = await fetch(`${API_URL}/gemini/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                screenContext,
                sessionId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }

        const data = await response.json();

        // Display response
        const responseDiv = document.getElementById('geminiResponse');
        const responseText = document.getElementById('responseText');
        responseText.textContent = data.assistantText;
        responseDiv.classList.remove('hidden');

        // Speak the response
        speak(data.assistantText);

    } catch (err) {
        console.error('Error sending to Gemini:', err);
        updateVoiceStatus('error', 'Error: ' + err.message);
    }
}

// ==================== Screen Sharing ====================

async function toggleScreenShare() {
    if (screenStream) {
        stopScreenShare();
    } else {
        await startScreenShare();
    }
}

async function waitForVideoReady(video, timeoutMs = 6000) {
    if (!video) return false;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return true;

    return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        const done = () => {
            clearTimeout(timer);
            resolve(video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
        };
        video.onloadedmetadata = done;
        video.oncanplay = done;
    });
}

async function captureScreenFrame() {
    if (!screenVideoElement || !screenCanvas) {
        console.error('Screen capture elements not initialized');
        return null;
    }

    const ready = await waitForVideoReady(screenVideoElement);
    if (!ready) {
        console.error('Screen video was not ready in time for capture');
        return null;
    }

    const ctx = screenCanvas.getContext('2d');
    ctx.drawImage(screenVideoElement, 0, 0, screenCanvas.width, screenCanvas.height);

    // Get base64 JPEG data (strip data:image/jpeg;base64, prefix)
    const dataUrl = screenCanvas.toDataURL('image/jpeg', 0.6);
    return dataUrl.split(',')[1];
}

async function analyzeCurrentScreen() {
    const base64Image = await captureScreenFrame();
    if (!base64Image) {
        alert('No screen capture available. Start screen sharing first.');
        return;
    }

    console.log('Screen frame captured, base64 size:', base64Image.length);
    if (base64Image.length > 1_800_000) {
        console.warn('Large image payload; may cause request issues.');
    }
    
    // Show analyzing state
    updateVoiceStatus('thinking', '🔍 Analyzing screen...');
    
    // Initialize session if needed
    if (!sessionId) {
        try {
            const response = await fetch(`${API_URL}/gemini/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'voice' })
            });
            const data = await response.json();
            if (data.error) {
                alert(data.error);
                return;
            }
            sessionId = data.sessionId;
            console.log('Gemini session initialized:', sessionId);
        } catch (err) {
            alert('Failed to initialize Gemini session: ' + err.message);
            return;
        }
    }
    
    // Send screen to Gemini for analysis
    try {
        const response = await fetch(`${API_URL}/gemini/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                screenImageBase64: base64Image,
                screenContext: screenContext,
                sessionId: sessionId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }

        const data = await response.json();

        // Display response
        const responseDiv = document.getElementById('geminiResponse');
        const responseText = document.getElementById('responseText');
        responseText.textContent = data.assistantText;
        responseDiv.classList.remove('hidden');

        // Speak the response
        speak(data.assistantText);
        
        // Update transcript to show screen was analyzed
        const transcriptText = document.getElementById('transcriptText');
        transcriptText.textContent = '[Screen analyzed automatically]';

    } catch (err) {
        console.error('Error analyzing screen:', err);
        updateVoiceStatus('error', 'Error: ' + err.message);
    }
}

async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });

        // Track when user stops sharing via the browser UI
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        // Get track settings for context
        const track = screenStream.getVideoTracks()[0];
        const settings = track.getSettings();

        screenContext = `Screen shared: ${settings.width}x${settings.height}, display surface: ${settings.displaySurface || 'unknown'}`;

        // Create hidden video element for frame capture
        screenVideoElement = document.createElement('video');
        screenVideoElement.srcObject = screenStream;
        screenVideoElement.play();
        
        // Create canvas for frame capture (downscaled to keep payload practical)
        const rawW = settings.width || 1920;
        const rawH = settings.height || 1080;
        const maxW = 1280;
        const scale = Math.min(1, maxW / rawW);
        screenCanvas = document.createElement('canvas');
        screenCanvas.width = Math.round(rawW * scale);
        screenCanvas.height = Math.round(rawH * scale);

        document.getElementById('screenPreview').classList.remove('hidden');
        document.getElementById('screenContext').textContent = screenContext;
        document.getElementById('screenBtn').textContent = '🛑 Stop Sharing';
        document.getElementById('analyzeScreenBtn').classList.remove('hidden');

        console.log('Screen sharing started:', screenContext);
        
        // Wait a moment for video to be ready, then auto-capture and analyze
        setTimeout(async () => {
            if (screenStream && screenStream.active) {
                console.log('Auto-capturing screen frame for diagnosis...');
                await analyzeCurrentScreen();
            }
        }, 1500); // Give video time to stabilize

    } catch (err) {
        console.error('Failed to start screen share:', err);
        alert('Could not start screen sharing: ' + err.message);
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    screenContext = null;
    screenVideoElement = null;
    screenCanvas = null;
    document.getElementById('screenPreview').classList.add('hidden');
    document.getElementById('screenBtn').textContent = '🖥️ Share Screen';
    document.getElementById('analyzeScreenBtn').classList.add('hidden');
}

// ==================== Incident Analysis (Original) ====================

async function analyzeIncident() {
    const input = document.getElementById('incidentInput').value.trim();
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const btn = document.getElementById('analyzeBtn');
    
    if (!input) {
        alert('Please describe the incident');
        return;
    }
    
    loading.classList.remove('hidden');
    btn.disabled = true;
    results.classList.add('hidden');
    
    try {
        const response = await fetch(`${API_URL}/incident/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incidentText: input })
        });
        
        if (!response.ok) throw new Error('Analysis failed');
        
        const data = await response.json();
        renderResults(data);
        results.classList.remove('hidden');
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        loading.classList.add('hidden');
        btn.disabled = false;
    }
}

function renderResults(data) {
    // Summary
    document.getElementById('summary').textContent = data.summary;
    document.getElementById('confidence').textContent = `Confidence: ${Math.round(data.confidence * 100)}%`;
    
    // Hypotheses
    const hypoList = document.getElementById('hypotheses');
    hypoList.innerHTML = data.hypotheses.map(h => `<li>${h}</li>`).join('');
    
    // Actions
    const actionList = document.getElementById('actions');
    actionList.innerHTML = data.nextActions.map(a => `<li>${a}</li>`).join('');
    
    // Flight Recorder
    const timeline = document.getElementById('flightRecorder');
    timeline.innerHTML = data.flightRecorder.map(event => `
        <div class="timeline-item">
            <div class="timeline-header">
                <span class="role-badge role-${event.role.toLowerCase().replace(' ', '-')}">${event.role}</span>
                <span class="timestamp">${new Date(event.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="timeline-body">
                <p><strong>Input:</strong> ${event.inputSummary}</p>
                <p><strong>Output:</strong> ${event.outputSummary}</p>
                <span class="confidence-small">Confidence: ${Math.round(event.confidence * 100)}%</span>
            </div>
        </div>
    `).join('');
}

// Enter key to submit
document.getElementById('incidentInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
        analyzeIncident();
    }
});
