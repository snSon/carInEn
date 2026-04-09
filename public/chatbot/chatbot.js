import { db } from "../firebase/firebase-config.js";
import { appConfig } from "../config/app-config.js";
import { watchSession } from "../auth/auth-service.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const OPENAI_API_KEY = appConfig.openai.apiKey;

const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const recordingStatus = document.getElementById("recordingStatus");
const accessDeniedMessage = document.getElementById("accessDeniedMessage");

let isChatbotBlocked = true;

function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

document.getElementById("initTime").textContent = getCurrentTime();

function setBlockedState(message) {
    isChatbotBlocked = true;
    accessDeniedMessage.hidden = false;
    accessDeniedMessage.textContent = message;
    if (chatBox) chatBox.style.display = "none";
    if (recordingStatus) recordingStatus.style.display = "none";
    if (chatInput) {
        chatInput.disabled = true;
        chatInput.placeholder = "접근 권한이 없는 계정입니다.";
    }
    if (sendBtn) sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;
}

function clearBlockedState() {
    isChatbotBlocked = false;
    accessDeniedMessage.hidden = true;
    if (chatBox) chatBox.style.display = "";
    if (recordingStatus) recordingStatus.style.display = "";
    if (chatInput) {
        chatInput.disabled = false;
        chatInput.placeholder = "메시지를 입력하세요...";
    }
    if (sendBtn) sendBtn.disabled = false;
    if (micBtn) micBtn.disabled = false;
}

watchSession((session) => {
    if (!session || session.role !== "user") {
        setBlockedState("일반 사용자 계정만 AI Chatbot에 접근할 수 있습니다.");
        return;
    }

    clearBlockedState();
});

function appendMessage(sender, text) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", sender);

    const bubbleDiv = document.createElement("div");
    bubbleDiv.classList.add("bubble");
    bubbleDiv.textContent = text;

    const timeDiv = document.createElement("div");
    timeDiv.classList.add("time");
    timeDiv.textContent = getCurrentTime();

    messageDiv.appendChild(bubbleDiv);
    messageDiv.appendChild(timeDiv);
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function getLatestDrivingData() {
    try {
        const logsRef = collection(db, "telematics_logs");
        const q = query(logsRef, orderBy("timestamp", "desc"), limit(20));
        const snapshot = await getDocs(q);

        if (snapshot.empty) return "";

        let contextStr = "";
        snapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data();
            const time = data.timestampText || "-";
            const level = data.logLevel || "INFO";
            const event = data.event || "-";
            const speed = data.speed || "-";
            const impact = data.impact || "-";
            const msg = data.message || data.rawLog || "";

            contextStr += `[${time}] 레벨:${level} | 이벤트:${event} | 속도:${speed} | 충격:${impact} | 내용:${msg}\n`;
        });
        return contextStr;
    } catch (error) {
        console.error("Firebase 데이터 조회 실패:", error);
        return "";
    }
}

async function getAIResponse(userMessage) {
    const loadingId = "loading-" + Date.now();
    appendMessage("ai", "차량 데이터를 분석 중입니다...");
    chatBox.lastChild.setAttribute("id", loadingId);

    const drivingData = await getLatestDrivingData();

    let systemPrompt = "당신은 차량 인포테인먼트 AI 비서입니다. 주행 데이터를 기반으로 운전자에게 친절하고 명확한 답변을 제공합니다.";
    if (drivingData) {
        systemPrompt += `\n\n[최근 주행 데이터]\n${drivingData}`;
    }

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                max_tokens: 300
            })
        });

        const data = await response.json();
        const aiMessage = data.choices[0].message.content;

        document.getElementById(loadingId).remove();
        appendMessage("ai", aiMessage);
        speakText(aiMessage);

    } catch (error) {
        console.error("OpenAI API 오류:", error);
        document.getElementById(loadingId).remove();
        appendMessage("ai", "응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
}

function speakText(text) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    window.speechSynthesis.speak(utterance);
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;

    recognition.onstart = () => {
        recordingStatus.classList.remove("hidden");
        micBtn.style.color = "red";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
    };

    recognition.onend = () => {
        recordingStatus.classList.add("hidden");
        micBtn.style.color = "#00eaff";
    };

    recognition.onerror = (event) => {
        console.error("음성 인식 오류:", event.error);
        recordingStatus.classList.add("hidden");
        micBtn.style.color = "#00eaff";
    };
} else {
    micBtn.style.display = "none";
}

sendBtn.addEventListener("click", () => {
    if (isChatbotBlocked) return;
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage("user", text);
    chatInput.value = "";
    getAIResponse(text);
});

chatInput.addEventListener("keypress", (event) => {
    if (isChatbotBlocked) return;
    if (event.key === "Enter") {
        sendBtn.click();
    }
});

micBtn.addEventListener("click", () => {
    if (isChatbotBlocked) return;
    if (recognition) {
        recognition.start();
    } else {
        alert("이 브라우저에서는 음성 인식을 지원하지 않습니다.");
    }
});
