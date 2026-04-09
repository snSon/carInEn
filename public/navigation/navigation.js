import { appConfig } from "../config/app-config.js";
import { loadKakaoSdk } from "../config/kakao-loader.js";

/*****************************************************************
 * 추가 반영
 * 1) 경로 선 가시성 강화: 2겹 폴리라인(외곽선 + 본선)
 * 2) ✅ Ready/Locating 표시 제거 (statusText DOM 삭제)
 * 3) ✅ 현재 위치 위도/경도 표시 제거 (originText DOM 삭제)
 *****************************************************************/

const REST_API_KEY = appConfig.kakao.restApiKey;

// ====== 지도/서비스 ======
let map;
let places;
let infoWindow;

let originMarker;
let destMarker;

let routeOutlinePolyline; // 외곽선(두껍게)
let routeMainPolyline;    // 본선

let searchMarkers = [];
let destLabelOverlay;

let currentLat = 37.50136;
let currentLng = 127.0396;

// ====== DOM ======
const $ = (id) => document.getElementById(id);
const elRoute  = () => $("routeText");
const elResults = () => $("results");
const elInput = () => $("searchInput");
const elAC = () => $("autocomplete");

// ====== F217: 검색 기록 저장/자동완성 ======
const HISTORY_KEY = "ssafy_nav_search_history_v1";
const HISTORY_MAX = 10;

let acOpen = false;
let acIndex = -1;
let acItems = [];

function loadHistory(){
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function saveHistory(keyword){
  const k = keyword.trim();
  if (!k) return;
  const list = loadHistory();
  const dedup = [k, ...list.filter(x => x !== k)];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(dedup.slice(0, HISTORY_MAX)));
}

function buildSuggestions(inputValue){
  const v = inputValue.trim();
  if (!v) return [];
  const history = loadHistory();
  const starts = history.filter(h => h.toLowerCase().startsWith(v.toLowerCase()));
  const includes = history
    .filter(h => !starts.includes(h))
    .filter(h => h.toLowerCase().includes(v.toLowerCase()));
  return [...starts, ...includes].slice(0, 8);
}

function openAutocomplete(items){
  const panel = elAC();
  panel.innerHTML = "";
  acItems = items;
  acIndex = -1;

  if (!items.length){
    closeAutocomplete();
    return;
  }

  items.forEach((text, idx) => {
    const div = document.createElement("div");
    div.className = "ac-item";
    div.setAttribute("role", "option");
    div.dataset.idx = String(idx);
    div.innerHTML = `
      <div class="ac-left">
        <div class="ac-ico">⏱</div>
        <div class="ac-text">${escapeHtml(text)}</div>
      </div>
      <div class="ac-sub">기록</div>
    `;
    div.addEventListener("mousedown", (e) => {
      e.preventDefault();
      applySuggestion(text);
    });
    panel.appendChild(div);
  });

  panel.hidden = false;
  acOpen = true;
}

function closeAutocomplete(){
  elAC().hidden = true;
  elAC().innerHTML = "";
  acOpen = false;
  acIndex = -1;
  acItems = [];
}

function highlightAutocomplete(index){
  const children = Array.from(elAC().children);
  children.forEach((c) => c.classList.remove("active"));
  if (index >= 0 && index < children.length){
    children[index].classList.add("active");
  }
}

function applySuggestion(text){
  elInput().value = text;
  closeAutocomplete();
  searchPlaces();
}

function escapeHtml(str){
  return str
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ====== 지도 초기화 ======
function initMap() {
  const options = {
    center: new kakao.maps.LatLng(currentLat, currentLng),
    level: 4
  };

  map = new kakao.maps.Map($("map"), options);
  places = new kakao.maps.services.Places();
  infoWindow = new kakao.maps.InfoWindow({ zIndex: 3 });

  originMarker = new kakao.maps.Marker({
    position: new kakao.maps.LatLng(currentLat, currentLng),
    map
  });

  elRoute().textContent = "대기중";
}

// 현재 위치(내부 좌표만 갱신 / 화면 출력 없음)
function resolveCurrentLocation() {
  if (!navigator.geolocation) {
    // 화면에 Ready/좌표를 표시하지 않음. 기본 좌표 유지.
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;

      const ll = new kakao.maps.LatLng(currentLat, currentLng);
      map.setCenter(ll);
      originMarker.setPosition(ll);
      // ✅ 좌표 텍스트 출력 없음
    },
    () => {
      // ✅ 실패해도 출력 없음(기본 좌표 유지)
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

// ====== (F214) 검색 ======
function searchPlaces() {
  const keyword = elInput().value.trim();
  if (!keyword) {
    alert("검색어를 입력해주세요.");
    return;
  }

  saveHistory(keyword);

  clearSearchMarkers();
  elResults().innerHTML = "";
  elRoute().textContent = "검색중…";

  places.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK || !data?.length) {
      elRoute().textContent = "검색 결과 없음";
      elResults().innerHTML =
        `<div style="padding:14px;color:rgba(255,255,255,0.7);">검색 결과가 없습니다.</div>`;
      return;
    }

    elRoute().textContent = `${data.length}개 결과`;

    const bounds = new kakao.maps.LatLngBounds();

    data.forEach((p, idx) => {
      const lat = Number(p.y);
      const lng = Number(p.x);
      const pos = new kakao.maps.LatLng(lat, lng);
      bounds.extend(pos);

      const mk = new kakao.maps.Marker({ map, position: pos });
      searchMarkers.push(mk);

      const item = document.createElement("div");
      item.className = "result-item";

      const addr = (p.road_address_name || p.address_name || "").trim();
      item.innerHTML = `
        <div class="place-name">${idx + 1}. ${escapeHtml(p.place_name)}</div>
        <div class="place-addr">${escapeHtml(addr || "주소 정보 없음")}</div>
        <div class="place-meta">
          <span class="badge cyan">목적지</span>
          <span class="badge">${escapeHtml(p.category_name ? p.category_name.split(">").pop().trim() : "장소")}</span>
        </div>
      `;

      item.addEventListener("click", () => selectDestination(p, lat, lng));
      kakao.maps.event.addListener(mk, "click", () => selectDestination(p, lat, lng));

      elResults().appendChild(item);
    });

    map.setBounds(bounds);
  });
}

function selectDestination(place, destLat, destLng){
  clearSearchMarkers();
  if (infoWindow) infoWindow.close();

  if (destMarker) destMarker.setMap(null);
  const destPos = new kakao.maps.LatLng(destLat, destLng);
  destMarker = new kakao.maps.Marker({ map, position: destPos });

  showDestinationLabel(destPos, place.place_name);
  drawRouteToDestination(destLat, destLng, place.place_name);
}

function clearSearchMarkers(){
  searchMarkers.forEach(m => m.setMap(null));
  searchMarkers = [];
}

function showDestinationLabel(position, name){
  const safeName = escapeHtml(name || "목적지");
  const content = `
    <div class="dest-label">
      <span class="name">Destination</span>${safeName}
    </div>
  `;

  if (destLabelOverlay) destLabelOverlay.setMap(null);

  destLabelOverlay = new kakao.maps.CustomOverlay({
    position,
    content,
    yAnchor: 1.35,
    xAnchor: 0.5
  });

  destLabelOverlay.setMap(map);
}

// ====== (F215) 경로 표시 + bounds 갱신 ======
async function drawRouteToDestination(destLat, destLng, destName){
  elRoute().textContent = "경로 생성중…";

  if (routeOutlinePolyline) routeOutlinePolyline.setMap(null);
  if (routeMainPolyline) routeMainPolyline.setMap(null);

  const origin = `${currentLng},${currentLat}`;
  const destination = `${destLng},${destLat}`;

  try{
    const res = await axios.get("https://apis-navi.kakaomobility.com/v1/directions", {
      headers: { Authorization: `KakaoAK ${REST_API_KEY}` },
      params: { origin, destination }
    });

    const route = res.data?.routes?.[0];
    if (!route || !route.sections?.length) {
      elRoute().textContent = "경로 없음";
      alert("경로 정보를 가져오지 못했습니다.");
      return;
    }

    const linePath = [];
    route.sections.forEach(section => {
      section.roads.forEach(road => {
        for (let i = 0; i < road.vertexes.length; i += 2) {
          const lng = road.vertexes[i];
          const lat = road.vertexes[i + 1];
          linePath.push(new kakao.maps.LatLng(lat, lng));
        }
      });
    });

    if (linePath.length < 2){
      elRoute().textContent = "경로 생성 실패";
      return;
    }

    routeOutlinePolyline = new kakao.maps.Polyline({
      path: linePath,
      strokeWeight: 12,
      strokeColor: "#000000",
      strokeOpacity: 0.85,
      strokeStyle: "solid"
    });
    routeOutlinePolyline.setMap(map);

    routeMainPolyline = new kakao.maps.Polyline({
      path: linePath,
      strokeWeight: 7,
      strokeColor: "#ff3b30",
      strokeOpacity: 0.95,
      strokeStyle: "solid"
    });
    routeMainPolyline.setMap(map);

    const bounds = new kakao.maps.LatLngBounds();
    linePath.forEach(pt => bounds.extend(pt));
    bounds.extend(new kakao.maps.LatLng(currentLat, currentLng));
    bounds.extend(new kakao.maps.LatLng(destLat, destLng));
    map.setBounds(bounds);

    elRoute().textContent = `안내중: ${destName}`;

  }catch(err){
    console.error(err);
    elRoute().textContent = "길찾기 실패";
    alert("길찾기 API 호출에 실패했습니다. (REST 키/도메인 설정 확인)");
  }
}

// ====== 입력 이벤트 ======
function bindEvents(){
  $("searchBtn").addEventListener("click", () => {
    closeAutocomplete();
    searchPlaces();
  });

  elInput().addEventListener("input", () => {
    const items = buildSuggestions(elInput().value);
    if (items.length) openAutocomplete(items);
    else closeAutocomplete();
  });

  elInput().addEventListener("keydown", (e) => {
    if (!acOpen) {
      if (e.key === "Enter") searchPlaces();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, acItems.length - 1);
      highlightAutocomplete(acIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, 0);
      highlightAutocomplete(acIndex);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (acIndex >= 0 && acIndex < acItems.length) applySuggestion(acItems[acIndex]);
      else { closeAutocomplete(); searchPlaces(); }
    } else if (e.key === "Escape") {
      closeAutocomplete();
    }
  });

  elInput().addEventListener("focus", () => {
    const items = buildSuggestions(elInput().value);
    if (items.length) openAutocomplete(items);
  });

  elInput().addEventListener("blur", () => {
    setTimeout(() => closeAutocomplete(), 120);
  });

  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".input-wrap");
    if (wrap && !wrap.contains(e.target)) closeAutocomplete();
  });
}

window.addEventListener("load", async () => {
  try {
    await loadKakaoSdk(appConfig.kakao.navigationJavascriptKey);
    initMap();
    resolveCurrentLocation();
    bindEvents();
  } catch (error) {
    console.error("Kakao SDK load failed:", error);
    alert("Kakao 지도 설정을 확인해 주세요.");
  }
});
