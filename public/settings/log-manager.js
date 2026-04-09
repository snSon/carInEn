import { db } from "../firebase/firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  writeBatch,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const formEls = {
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  logLevel: document.getElementById("logLevel"),
  keyword: document.getElementById("keyword"),
  userId: document.getElementById("userId"),
  applyButton: document.getElementById("applyFilterBtn"),
  resetButton: document.getElementById("resetFilterBtn"),
  rawLogFile: document.getElementById("rawLogFile"),
};

const viewEls = {
  queryStatus: document.getElementById("queryStatus"),
  uploadStatus: document.getElementById("uploadStatus"),
  totalCount: document.getElementById("totalCount"),
  infoCount: document.getElementById("infoCount"),
  warningCount: document.getElementById("warningCount"),
  errorCount: document.getElementById("errorCount"),
  logList: document.getElementById("logList"),
  listMeta: document.getElementById("listMeta"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
};

let unsubscribeLogs = null;
const COLLECTION_NAME = "telematics_logs";
const RAW_COLLECTION_NAME = "raw_telematics_logs";
const MAX_DOCS = 200;
const BATCH_SIZE = 400;

function getFilters() {
  return {
    startDate: formEls.startDate.value,
    endDate: formEls.endDate.value,
    logLevel: formEls.logLevel.value,
    keyword: formEls.keyword.value.trim(),
    userId: formEls.userId.value.trim(),
  };
}

function resetFilters() {
  formEls.startDate.value = "";
  formEls.endDate.value = "";
  formEls.logLevel.value = "ALL";
  formEls.keyword.value = "";
  formEls.userId.value = "";
}

function setUploadStatus(message) {
  if (viewEls.uploadStatus) {
    viewEls.uploadStatus.textContent = message;
  }
}

function toTimestampOrNull(localDateTimeValue) {
  if (!localDateTimeValue) return null;
  const date = new Date(localDateTimeValue);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

function parseLogLine(rawLog) {
  if (!rawLog) return {};
  let line = rawLog.trim();
  
  if (line.startsWith("[")) {
    line = line.substring(1);
  }
  
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length < 4) return { rawLog };

  const parsed = {
    timestampText: parts[0],
    user: parts[1],
    logLevel: parts[2].toUpperCase(),
    rawLog: rawLog,
  };

  const detailStr = parts.slice(3).join(" | ");
  const detailParts = detailStr.split("  ").map((s) => s.trim()).filter(Boolean);

  detailParts.forEach((part) => {
    const eqIdx = part.indexOf("=");
    if (eqIdx !== -1) {
      const key = part.substring(0, eqIdx).trim().toLowerCase();
      const val = part.substring(eqIdx + 1).trim();

      if (key === "event") parsed.event = val;
      else if (key === "impact") parsed.impact = val;
      else if (key === "speed") parsed.speed = val;
      else if (key === "accel") parsed.accel = val;
      else if (key === "brake") parsed.brake = val;
      else if (key === "dist") parsed.dist = val;
      else if (key === "engtemp") parsed.engTemp = val;
      else if (key === "fueleff") parsed.fuelEff = val;
      else if (key === "gforce") parsed.gForce = val;
      else if (key === "location") parsed.location = val;
    }
  });

  return parsed;
}

function normalizeLevel(level) {
  const value = String(level || "").toUpperCase();
  if (value === "CRITICAL") return "critical";
  if (value === "WARNING") return "warning";
  if (value === "ERROR") return "error";
  return "info";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value, fallbackText = "-") {
  if (value?.toDate) {
    const date = value.toDate();
    return date.toLocaleString("ko-KR", {
      hour12: false,
    });
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return fallbackText;
}

function renderSummary(logs) {
  const info = logs.filter((log) => String(log.logLevel).toUpperCase() === "INFO").length;
  const warning = logs.filter((log) => String(log.logLevel).toUpperCase() === "WARNING").length;
  const error = logs.filter((log) => String(log.logLevel).toUpperCase() === "ERROR").length;
  const critical = logs.filter((log) => String(log.logLevel).toUpperCase() === "CRITICAL").length;

  viewEls.totalCount.textContent = String(logs.length);
  viewEls.infoCount.textContent = String(info);
  viewEls.warningCount.textContent = String(warning);
  viewEls.errorCount.textContent = String(error + critical);
  viewEls.listMeta.textContent = `${logs.length}건`;
}

function createDetailBox(label, value) {
  return `
    <div class="detail-box">
      <span class="detail-key">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(value ?? "-")}</span>
    </div>
  `;
}

function renderLogs(logs) {
  viewEls.loadingState.classList.add("hidden");
  viewEls.logList.innerHTML = "";

  if (logs.length === 0) {
    viewEls.emptyState.classList.remove("hidden");
    renderSummary([]);
    return;
  }

  viewEls.emptyState.classList.add("hidden");
  renderSummary(logs);

  const html = logs
    .map((rawDoc) => {
      const log = rawDoc.speed ? rawDoc : { ...rawDoc, ...parseLogLine(rawDoc.rawLog) };

      const levelUpper = String(log.logLevel || "INFO").toUpperCase();
      const levelClass = normalizeLevel(levelUpper);

      const timestampText = formatTimestamp(log.timestamp, log.timestampText || "-");
      const user = log.user || "unknown";
      const message = log.message || log.rawLog || "(no message)";
      
      const event = log.event || "-";
      const impact = log.impact || "-";
      const brake = log.brake || "-";
      const speed = log.speed ?? "-";
      const accel = log.accel ?? "-";
      const dist = log.dist ?? "-";
      const fuelEff = log.fuelEff ?? "-";
      const engTemp = log.engTemp ?? "-";
      const gForce = log.gForce ?? "-";
      const location = log.location ?? "-";

      return `
        <article class="log-item ${levelClass}">
          <div class="log-top">
            <div class="log-meta-left">
              <span class="level-badge ${levelClass}">${escapeHtml(levelUpper)}</span>
              <span class="timestamp">${escapeHtml(timestampText)}</span>
              <span class="user-chip">${escapeHtml(user)}</span>
            </div>
          </div>

          <div class="log-message">${escapeHtml(message)}</div>

          <div class="log-detail-grid">
            ${createDetailBox("EVENT", event)}
            ${createDetailBox("IMPACT", impact)}
            ${createDetailBox("BRAKE", brake)}
            ${createDetailBox("SPEED", speed)}
            ${createDetailBox("ACCEL", accel)}
            ${createDetailBox("DIST", dist)}
            ${createDetailBox("FUEL", fuelEff)}
            ${createDetailBox("ENG TEMP", engTemp)}
            ${createDetailBox("G FORCE", gForce)}
            ${createDetailBox("LOCATION", location)}
          </div>
        </article>
      `;
    })
    .join("");

  viewEls.logList.innerHTML = html;
}

function matchesKeyword(log, keyword) {
  if (!keyword) return true;

  const target = [
    log.message,
    log.rawLog,
    log.event,
    log.impact,
    log.user,
    log.logLevel,
    log.timestampText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return target.includes(keyword.toLowerCase());
}

function applyClientFilters(docs, filters) {
  let logs = docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));

  if (filters.keyword) {
    logs = logs.filter((log) => matchesKeyword(log, filters.keyword));
  }

  return logs;
}

function buildFirestoreQuery(filters) {
  const logsRef = collection(db, COLLECTION_NAME);
  const conditions = [];

  if (filters.logLevel !== "ALL") {
    conditions.push(where("logLevel", "==", filters.logLevel));
  }

  if (filters.userId) {
    conditions.push(where("user", "==", filters.userId));
  }

  const startTs = toTimestampOrNull(filters.startDate);
  if (startTs) {
    conditions.push(where("timestamp", ">=", startTs));
  }

  const endTs = toTimestampOrNull(filters.endDate);
  if (endTs) {
    conditions.push(where("timestamp", "<=", endTs));
  }

  return query(
    logsRef,
    ...conditions,
    orderBy("timestamp", "desc"),
    limit(MAX_DOCS)
  );
}

function setQueryStatus(filters) {
  const lines = [
    `컬렉션: ${COLLECTION_NAME}`,
    `레벨: ${filters.logLevel}`,
    `사용자 ID: ${filters.userId || "ALL"}`,
    `키워드: ${filters.keyword || "없음"}`,
    `시작: ${filters.startDate || "없음"}`,
    `종료: ${filters.endDate || "없음"}`,
    `정렬: timestamp desc`,
    `최대 조회 수: ${MAX_DOCS}`,
  ];

  viewEls.queryStatus.textContent = lines.join("\n");
}

function subscribeLogs() {
  const filters = getFilters();
  setQueryStatus(filters);

  if (unsubscribeLogs) {
    unsubscribeLogs();
    unsubscribeLogs = null;
  }

  viewEls.loadingState.classList.remove("hidden");
  viewEls.emptyState.classList.add("hidden");
  viewEls.logList.innerHTML = "";

  const q = buildFirestoreQuery(filters);

  unsubscribeLogs = onSnapshot(
    q,
    (snapshot) => {
      const logs = applyClientFilters(snapshot.docs, filters);
      renderLogs(logs);
    },
    (error) => {
      console.error(error);
      viewEls.loadingState.classList.add("hidden");
      viewEls.emptyState.classList.remove("hidden");
      viewEls.emptyState.textContent = `로그를 불러오지 못했습니다. ${error.message}`;
      renderSummary([]);
    }
  );
}

async function uploadLinesInBatches(fileName, lines) {
  let uploadedCount = 0;

  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const chunk = lines.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach((line, idx) => {
      const ref = doc(collection(db, RAW_COLLECTION_NAME));
      batch.set(ref, {
        rawLog: line,
        fileName,
        lineNumber: i + idx + 1,
        status: "uploaded",
        uploadedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    uploadedCount += chunk.length;

    setUploadStatus(
      [
        `업로드 중...`,
        `파일명: ${fileName}`,
        `총 라인 수: ${lines.length}`,
        `완료: ${uploadedCount}/${lines.length}`,
      ].join("\n")
    );
  }
}

async function handleRawLogUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    setUploadStatus(`파일 읽는 중...\n파일명: ${file.name}`);

    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      setUploadStatus("업로드할 로그가 없습니다.");
      return;
    }

    const recentLines = lines.slice(-50).join("\n");
    localStorage.setItem("sharedDrivingData", recentLines);

    await uploadLinesInBatches(file.name, lines);

    setUploadStatus(
      [
        `업로드 완료`,
        `파일명: ${file.name}`,
        `총 저장 라인 수: ${lines.length}`,
        ``,
        `raw_telematics_logs 저장 완료`,
        `Functions가 자동 정제 후 telematics_logs에 반영합니다.`,
      ].join("\n")
    );
  } catch (error) {
    console.error(error);
    setUploadStatus(`업로드 실패\n${error.message}`);
  } finally {
    formEls.rawLogFile.value = "";
  }
}

function bindEvents() {
  formEls.applyButton.addEventListener("click", subscribeLogs);

  formEls.resetButton.addEventListener("click", () => {
    resetFilters();
    subscribeLogs();
  });

  formEls.keyword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      subscribeLogs();
    }
  });

  formEls.userId.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      subscribeLogs();
    }
  });

  if (formEls.rawLogFile) {
    formEls.rawLogFile.addEventListener("change", handleRawLogUpload);
  }
}

bindEvents();
subscribeLogs();
setUploadStatus("업로드 대기 중");