import { appConfig } from "../config/app-config.js";

// ✅ OpenWeatherMap API KEY
const OWM_API_KEY = appConfig.openWeather.forecastApiKey;

// UI 선택자
const $ = (id) => document.getElementById(id);
const cardsEl = () => $("cards"); // HTML의 <div id="cards">를 가리킴
const placeText = () => $("placeText");
const updatedText = () => $("updatedText");

const VIEW_KEY = "ssafy_weather_view_v1";

function setUpdatedNow(){
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  updatedText().textContent = `${hh}:${mm}`;
}

function setView(mode){
  const el = cardsEl();
  if(!el) return;
  el.classList.remove("horizontal", "vertical");
  el.classList.add(mode);

  $("btnHorizontal").classList.toggle("active", mode === "horizontal");
  $("btnVertical").classList.toggle("active", mode === "vertical");

  localStorage.setItem(VIEW_KEY, mode);
}

function getSavedView(){
  const v = localStorage.getItem(VIEW_KEY);
  return (v === "vertical" || v === "horizontal") ? v : "horizontal";
}

function formatKST(dtText){
  const hhmm = dtText?.split(" ")?.[1]?.slice(0,5);
  return hhmm || "--:--";
}

function formatDate(dtText){
  const d = dtText?.split(" ")?.[0];
  return d || "---- -- --";
}

function iconUrl(icon){
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

// ✅ id="cards" 안에 카드를 생성해서 넣는 핵심 함수
function renderCards(forecastList, cityName){
  const el = cardsEl();
  el.innerHTML = ""; // 이전 로딩 메시지나 카드들 비우기

  // 3시간 간격 데이터 중 8개(24시간 분량) 표시
  const items = forecastList.slice(0, 8);

  items.forEach((it, idx) => {
    const temp = Math.round(it.main.temp);
    const feels = Math.round(it.main.feels_like);
    const hum = Math.round(it.main.humidity);
    const wind = Math.round(it.wind.speed);
    const desc = it.weather?.[0]?.description ?? "weather";
    const icon = it.weather?.[0]?.icon ?? "02d";
    const time = formatKST(it.dt_txt);
    const date = formatDate(it.dt_txt);

    const isHero = idx === 0;
    const card = document.createElement("div");
    card.className = "card";
    
    // 첫 카드 강조 스타일
    if (isHero) {
      card.style.borderColor = "rgba(0,234,255,0.35)";
      card.style.background = "rgba(0,234,255,0.12)";
    }

    // 카드 내부 구조
    card.innerHTML = `
      <div class="header">
        <div>
          <div class="time">${date} ${time}</div>
        </div>
        <div class="sub">${isHero ? "Now" : ""}</div>
      </div>
      <div class="wx-row">
        <div class="wx-left">
          <div class="wx-icon">
            <img src="${iconUrl(icon)}" alt="">
          </div>
          <div style="min-width:0;">
            <div class="temp">${temp}°C</div>
            <div class="desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</div>
          </div>
        </div>
      </div>
      <div class="metrics">
        <span class="pill cyan">습도 ${hum}%</span>
        <span class="pill">체감 ${feels}°C</span>
        <span class="pill">풍속 ${wind}m/s</span>
      </div>
    `;

    el.appendChild(card); // ✅ 여기서 <div id="cards"> 안으로 삽입됨
  });
}

function escapeHtml(str){
  return String(str ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

async function fetchForecast(lat, lon){
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric&lang=kr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Fetch failed");
  return res.json();
}

// 위치 불러오기
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 정보를 지원하지 않습니다."));
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => {
        // 에러 원인을 콘솔에 찍어보면 디버깅이 쉬워집니다.
        console.warn(`위치 획득 실패(${err.code}): ${err.message}`);
        reject(err);
      },
      {
        enableHighAccuracy: false, // true로 하면 더 정확하지만 시간이 오래 걸리고 실패 확률이 높음
        timeout: 10000,            // 10초로 연장
        maximumAge: 60000          // 1분 내에 측정된 위치 정보가 있다면 재사용
      }
    );
  });
}

// 날씨를 불러옵니다
async function loadWeather(){
  setUpdatedNow();
  placeText().textContent = "Locating…";
  cardsEl().innerHTML = `<div style="padding:14px;color:rgba(255,255,255,0.7);">Loading forecast…</div>`;

  let lat = 37.50136, lon = 127.0396; // 기본 좌표

  try{
    const pos = await getCurrentPosition();
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
  } catch(e) {}

  try{
    const data = await fetchForecast(lat, lon);
    const cityName = data?.city?.name ?? "Current location";
    placeText().textContent = cityName;
    setUpdatedNow();
    renderCards(data.list || [], cityName);
  } catch (e){
    placeText().textContent = "Error";
    cardsEl().innerHTML = `<div style="padding:14px;">데이터를 불러오지 못했습니다.</div>`;
  }
}

// 카드 모양 바꾸기
function bindUI(){
  $("btnHorizontal").addEventListener("click", () => setView("horizontal"));
  $("btnVertical").addEventListener("click", () => setView("vertical"));
  $("btnRefresh").addEventListener("click", loadWeather);

  const el = cardsEl();
  // 1. 마우스 휠로 가로 스크롤 (세로 휠 -> 가로 이동)
  el.addEventListener("wheel", (e) => {
    if (el.classList.contains("horizontal")) {
      e.preventDefault();
      // deltaY 값을 이용해 가로로 스크롤 이동
      el.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // 2. 마우스 드래그로 스크롤
  let isDown = false;
  let startX;
  let scrollLeft;

  el.addEventListener('mousedown', (e) => {
    if (!el.classList.contains("horizontal")) return;
    isDown = true;
    el.style.scrollBehavior = 'auto'; // 드래그 시에는 부드러운 스크롤 잠시 끔
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  });

  el.addEventListener('mouseleave', () => {
    isDown = false;
  });

  el.addEventListener('mouseup', () => {
    isDown = false;
    el.style.scrollBehavior = 'smooth'; // 드래그 종료 후 다시 부드럽게
  });

  el.addEventListener('mousemove', (e) => {
    if (!isDown || !el.classList.contains("horizontal")) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX) * 2; // 스크롤 감도 (2배)
    el.scrollLeft = scrollLeft - walk;
  });

  setView(getSavedView());
}

window.addEventListener("load", () => {
  bindUI();
  loadWeather();
});
