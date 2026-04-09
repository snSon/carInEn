import {
  quickAccessSsafy,
  watchSession,
} from "./auth/auth-service.js";
import { appConfig } from "./config/app-config.js";
import { loadKakaoSdk } from "./config/kakao-loader.js";

const DEFAULT_USER_NAME = "SSAFY";
const DEFAULT_PROFILE_IMAGE = "./images/avatar-modern.jpg";
const DEFAULT_BACKGROUND_IMAGE = "./images/dashboard-modern.jpg";
const HOME_INIT_KEY = "pjt5-home-initialized";
let currentSession = null;

function updateGreeting() {
  const greetingEl = document.getElementById("userGreeting");
  const profileNameEl = document.getElementById("mainProfileName");
  const profileImageEl = document.getElementById("mainProfileImage");
  const dashboardBgEl = document.querySelector(".dashboard-bg");
  if (!greetingEl) return;

  const userName = currentSession?.displayName || DEFAULT_USER_NAME;
  greetingEl.textContent = `안녕하세요! ${userName}님`;

  if (profileNameEl) {
    profileNameEl.textContent = userName;
  }

  if (profileImageEl) {
    profileImageEl.src = currentSession?.photoURL || DEFAULT_PROFILE_IMAGE;
  }

  if (dashboardBgEl) {
    dashboardBgEl.src = currentSession?.backgroundImageUrl || DEFAULT_BACKGROUND_IMAGE;
  }
}

function updateChatbotAccess() {
  const chatbotCard = document.getElementById("chatbotMenuCard");
  const restrictionText = document.getElementById("chatbotRestrictionText");
  const canAccessChatbot = currentSession?.role === "user";

  if (!chatbotCard) return;

  if (canAccessChatbot) {
    chatbotCard.classList.remove("restricted-card");
    chatbotCard.removeAttribute("aria-disabled");
    if (restrictionText) restrictionText.textContent = "";
    return;
  }

  chatbotCard.classList.add("restricted-card");
  chatbotCard.setAttribute("aria-disabled", "true");
  if (restrictionText) {
    restrictionText.textContent = "이용 불가";
  }
}

function openPage(page, title = "Sub Page") {
  const area = document.getElementById("contentArea");
  const frame = document.getElementById("contentFrame");
  const frameTitle = document.getElementById("frameTitle");

  if (!area || !frame) return;
  if (page.includes("./chatbot/") && currentSession?.role !== "user") {
    alert("이용 불가");
    return;
  }

  frame.src = page;
  area.style.display = "block";

  if (frameTitle) {
    frameTitle.textContent = title;
  }
}

function goHome() {
  const area = document.getElementById("contentArea");
  const frame = document.getElementById("contentFrame");
  const frameTitle = document.getElementById("frameTitle");

  if (!area || !frame) return;

  frame.src = "";
  area.style.display = "none";

  if (frameTitle) {
    frameTitle.textContent = "Home";
  }
}

window.openPage = openPage;
window.goHome = goHome;

function formatClock(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = String(m).padStart(2, "0");
  return `${h}:${mm} ${ampm}`;
}

function startClock() {
  const clockEl = document.getElementById("clock");
  if (!clockEl) return;

  const tick = () => {
    clockEl.textContent = formatClock(new Date());
  };

  tick();
  setInterval(tick, 1000);
}

window.addEventListener("load", startClock);

watchSession(async (session) => {
  const isFirstHomeEntry = !sessionStorage.getItem(HOME_INIT_KEY);

  if (isFirstHomeEntry) {
    sessionStorage.setItem(HOME_INIT_KEY, "true");
    try {
      await quickAccessSsafy();
      return;
    } catch (error) {
      console.warn("Default SSAFY quick access failed:", error);
    }
  }

  if (!session) {
    try {
      await quickAccessSsafy();
      return;
    } catch (error) {
      console.warn("Default SSAFY quick access failed:", error);
    }
  }

  currentSession = session;
  updateGreeting();
  updateChatbotAccess();
});

let mainMap;
let mainMarker;

const OWM_API_KEY = appConfig.openWeather.currentWeatherApiKey;
const DEFAULT_LAT = 37.50136;
const DEFAULT_LNG = 127.0396;

function initMainMap() {
  const mapEl = document.getElementById("mainMap");
  if (!mapEl || !window.kakao || !window.kakao.maps) return;

  const center = new kakao.maps.LatLng(DEFAULT_LAT, DEFAULT_LNG);

  mainMap = new kakao.maps.Map(mapEl, {
    center,
    level: 4,
  });

  mainMarker = new kakao.maps.Marker({
    position: center,
    map: mainMap,
  });

  updateWeatherOWM(DEFAULT_LAT, DEFAULT_LNG);

  if (!navigator.geolocation) {
    setWeatherText("Location unavailable", "?");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const current = new kakao.maps.LatLng(lat, lng);
      mainMap.setCenter(current);
      mainMarker.setPosition(current);
      updateWeatherOWM(lat, lng);
    },
    () => {
      setWeatherText("Location denied", "?");
    },
    {
      enableHighAccuracy: true,
      timeout: 6000,
      maximumAge: 30000,
    }
  );
}

window.addEventListener("load", async () => {
  try {
    await loadKakaoSdk(appConfig.kakao.dashboardJavascriptKey);
    initMainMap();
  } catch (error) {
    console.warn("Kakao SDK load failed:", error);
  }
});

function setWeatherText(text, icon = "??") {
  const weatherEl = document.getElementById("weather");
  if (!weatherEl) return;

  const iconEl = weatherEl.querySelector(".wx-icon");
  const textEl = weatherEl.querySelector(".wx-text");

  if (iconEl) iconEl.textContent = icon;
  if (textEl) textEl.textContent = text;
}

function owmIconToEmoji(iconCode) {
  const key = (iconCode || "").slice(0, 2);
  const map = {
    "01": "?",
    "02": "?",
    "03": "?",
    "04": "?",
    "09": "?",
    "10": "?",
    "11": "?",
    "13": "?",
    "50": "?",
  };
  return map[key] || "?";
}

async function updateWeatherOWM(lat, lng) {
  try {
    setWeatherText("Loading...", "?");

    if (!OWM_API_KEY || OWM_API_KEY.includes("YOUR_")) {
      setWeatherText("Set OWM API Key", "?");
      return;
    }

    const url =
      `https://api.openweathermap.org/data/2.5/weather` +
      `?lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lng)}` +
      `&appid=${encodeURIComponent(OWM_API_KEY)}` +
      `&units=metric&lang=kr`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("OWM weather fetch failed");

    const data = await res.json();
    const temp = Math.round(data?.main?.temp ?? 0);
    const desc = data?.weather?.[0]?.description ?? "weather";
    const icon = data?.weather?.[0]?.icon ?? "";
    const emoji = owmIconToEmoji(icon);

    setWeatherText(`${temp}C ${desc}`, emoji);
  } catch (error) {
    console.warn(error);
    setWeatherText("Weather unavailable", "?");
  }
}
