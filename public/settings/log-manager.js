import { db } from "../firebase/firebase-config.js";
import { listProfiles } from "../auth/auth-service.js";
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

const COLLECTION_NAME = "telematics_logs";
const RAW_COLLECTION_NAME = "raw_telematics_logs";
const MAX_DOCS = 200;
const BATCH_SIZE = 400;
const MAX_CHART_POINTS = 20;
const ANOMALY_THRESHOLDS = {
  speed: 120,
  engTemp: 105,
  accel: 4,
  gForce: 1.5,
};

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
  realtimeBadge: document.getElementById("realtimeBadge"),
  queryStatus: document.getElementById("queryStatus"),
  uploadStatus: document.getElementById("uploadStatus"),
  totalCount: document.getElementById("totalCount"),
  infoCount: document.getElementById("infoCount"),
  warningCount: document.getElementById("warningCount"),
  errorCount: document.getElementById("errorCount"),
  alertCount: document.getElementById("alertCount"),
  insightGrid: document.getElementById("insightGrid"),
  anomalyList: document.getElementById("anomalyList"),
  logList: document.getElementById("logList"),
  listMeta: document.getElementById("listMeta"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
};

let unsubscribeLogs = null;
let chartInstances = {};
let latestSnapshotDocs = [];
let currentProfiles = [];

function getFilters() {
  return {
    startDate: formEls.startDate.value,
    endDate: formEls.endDate.value,
    logLevel: formEls.logLevel.value,
    keyword: formEls.keyword.value.trim(),
    userId: formEls.userId.value,
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

function setRealtimeBadge(text, isLive = true) {
  if (!viewEls.realtimeBadge) return;
  viewEls.realtimeBadge.textContent = text;
  viewEls.realtimeBadge.classList.toggle("stale", !isLive);
}

function toTimestampOrNull(localDateTimeValue) {
  if (!localDateTimeValue) return null;
  const date = new Date(localDateTimeValue);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
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
    return value.toDate().toLocaleString("ko-KR", {
      hour12: false,
    });
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return fallbackText;
}

function formatNumber(value, digits = 1, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function normalizeLevel(level) {
  const value = String(level || "").toUpperCase();
  if (value === "WARNING" || value === "WARN") return "WARN";
  if (value === "ERROR" || value === "CRITICAL") return "ERROR";
  return "INFO";
}

function levelClass(level) {
  const normalized = normalizeLevel(level);
  if (normalized === "WARN") return "warning";
  if (normalized === "ERROR") return "error";
  return "info";
}

function parseLogLine(rawLog) {
  if (!rawLog) return {};

  const cleaned = String(rawLog).trim().replace(/^\[/, "");
  const parts = cleaned.split("|").map((part) => part.trim());
  if (parts.length < 4) return { rawLog };

  const body = parts.slice(3).join(" | ").trim();
  const readNumber = (regex) => {
    const match = body.match(regex);
    return match ? Number(match[1]) : null;
  };
  const readText = (regex) => {
    const match = body.match(regex);
    return match ? match[1] : null;
  };

  return {
    timestampText: parts[0] || null,
    user: parts[1] || null,
    logLevel: parts[2] || null,
    rawLog,
    message: body || rawLog,
    event: readText(/Event=([A-Za-z]+)/),
    impact: readText(/Impact=([A-Za-z]+)/),
    brake: readText(/Brake=(ON|OFF)/),
    speed: readNumber(/Speed=(-?\d+(?:\.\d+)?)/),
    accel: readNumber(/Accel=(-?\d+(?:\.\d+)?)/),
    dist: readNumber(/Dist=(-?\d+(?:\.\d+)?)/),
    engTemp: readNumber(/EngTemp=(-?\d+(?:\.\d+)?)/),
    fuelEff: readNumber(/FuelEff=(-?\d+(?:\.\d+)?)/),
    gForce: readNumber(/GForce=(-?\d+(?:\.\d+)?)/),
    location: readText(/Location=([-\d.,]+)/),
  };
}

function toLog(snapshotDoc) {
  const data = snapshotDoc.data();
  const parsed = data.speed == null && data.engTemp == null ? parseLogLine(data.rawLog) : {};
  return {
    id: snapshotDoc.id,
    ...parsed,
    ...data,
  };
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

function detectAnomalies(log) {
  const issues = [];

  if (Number(log.speed) > ANOMALY_THRESHOLDS.speed) {
    issues.push(`Speed ${formatNumber(log.speed, 0, " km/h")}`);
  }
  if (Number(log.engTemp) > ANOMALY_THRESHOLDS.engTemp) {
    issues.push(`Engine temp ${formatNumber(log.engTemp, 0, " C")}`);
  }
  if (Math.abs(Number(log.accel)) > ANOMALY_THRESHOLDS.accel) {
    issues.push(`Acceleration ${formatNumber(log.accel, 1, " m/s2")}`);
  }
  if (Math.abs(Number(log.gForce)) > ANOMALY_THRESHOLDS.gForce) {
    issues.push(`G-force ${formatNumber(log.gForce, 2, " G")}`);
  }

  return issues;
}

function applyClientFilters(docs, filters) {
  let logs = docs.map(toLog);

  if (filters.userId) {
    logs = logs.filter((log) => log.user === filters.userId);
  }

  if (filters.logLevel !== "ALL") {
    logs = logs.filter((log) => normalizeLevel(log.logLevel) === filters.logLevel);
  }

  if (filters.keyword) {
    logs = logs.filter((log) => matchesKeyword(log, filters.keyword));
  }

  return logs.map((log) => ({
    ...log,
    normalizedLevel: normalizeLevel(log.logLevel),
    anomalyReasons: detectAnomalies(log),
  }));
}

function buildFirestoreQuery(filters) {
  const logsRef = collection(db, COLLECTION_NAME);
  const conditions = [];

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

  return query(logsRef, ...conditions, orderBy("timestamp", "desc"), limit(MAX_DOCS));
}

function createDetailBox(label, value) {
  return `
    <div class="detail-box">
      <span class="detail-key">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(value ?? "-")}</span>
    </div>
  `;
}

function renderSummary(logs) {
  const info = logs.filter((log) => log.normalizedLevel === "INFO").length;
  const warning = logs.filter((log) => log.normalizedLevel === "WARN").length;
  const error = logs.filter((log) => log.normalizedLevel === "ERROR").length;

  viewEls.totalCount.textContent = String(logs.length);
  viewEls.infoCount.textContent = String(info);
  viewEls.warningCount.textContent = String(warning);
  viewEls.errorCount.textContent = String(error);
  viewEls.listMeta.textContent = `${logs.length} items`;
}

function renderInsights(logs) {
  const speedValues = logs.map((log) => Number(log.speed)).filter((value) => Number.isFinite(value));
  const tempValues = logs.map((log) => Number(log.engTemp)).filter((value) => Number.isFinite(value));
  const accelValues = logs.map((log) => Number(log.accel)).filter((value) => Number.isFinite(value));
  const anomalyCount = logs.filter((log) => log.anomalyReasons.length > 0).length;

  const avg = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const max = (values) => (values.length ? Math.max(...values) : null);

  const cards = [
    {
      label: "MAX SPEED",
      value: formatNumber(max(speedValues), 0, " km/h"),
    },
    {
      label: "MAX TEMP",
      value: formatNumber(max(tempValues), 0, " C"),
    },
    {
      label: "AVG ACCEL",
      value: formatNumber(avg(accelValues), 2, " m/s2"),
    },
    {
      label: "ANOMALIES",
      value: String(anomalyCount),
    },
  ];

  viewEls.insightGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="insight-item">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderAnomalies(logs) {
  const anomalyLogs = logs.filter((log) => log.anomalyReasons.length > 0).slice(0, 8);
  viewEls.alertCount.textContent = `${anomalyLogs.length} alerts`;

  if (!anomalyLogs.length) {
    viewEls.anomalyList.innerHTML = `
      <div class="empty-state compact-state">
        No out-of-range values were detected in the current result set.
      </div>
    `;
    return;
  }

  viewEls.anomalyList.innerHTML = anomalyLogs
    .map(
      (log) => `
        <article class="anomaly-item">
          <div class="anomaly-top">
            <strong>${escapeHtml(log.user || "unknown")}</strong>
            <span>${escapeHtml(formatTimestamp(log.timestamp, log.timestampText || "-"))}</span>
          </div>
          <p>${escapeHtml(log.anomalyReasons.join(" / "))}</p>
        </article>
      `
    )
    .join("");
}

function createChart(elementId, label, labels, values, datasetOptions) {
  const canvas = document.getElementById(elementId);
  if (!canvas || !window.Chart) return;

  if (chartInstances[elementId]) {
    chartInstances[elementId].destroy();
  }

  chartInstances[elementId] = new window.Chart(canvas, {
    type: datasetOptions.type,
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          ...datasetOptions,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#9aa9bf",
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
          },
        },
        y: {
          ticks: {
            color: "#9aa9bf",
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
          },
        },
      },
    },
  });
}

function renderCharts(logs) {
  const chartLogs = logs
    .slice()
    .reverse()
    .filter((log) => log.timestamp || log.timestampText)
    .slice(-MAX_CHART_POINTS);

  const labels = chartLogs.map((log) => {
    const text = formatTimestamp(log.timestamp, log.timestampText || "-");
    return text.split(" ").slice(-1)[0];
  });

  createChart(
    "speedChart",
    "Speed",
    labels,
    chartLogs.map((log) => log.speed),
    {
      type: "line",
      borderColor: "#00d4ff",
      backgroundColor: "rgba(0, 212, 255, 0.18)",
      tension: 0.28,
      fill: true,
      spanGaps: true,
      pointRadius: 3,
    }
  );

  createChart(
    "engineTempChart",
    "Engine temperature",
    labels,
    chartLogs.map((log) => log.engTemp),
    {
      type: "line",
      borderColor: "#ff8a5b",
      backgroundColor: "rgba(255, 138, 91, 0.18)",
      tension: 0.28,
      fill: true,
      spanGaps: true,
      pointRadius: 3,
    }
  );

  createChart(
    "accelChart",
    "Acceleration",
    labels,
    chartLogs.map((log) => log.accel),
    {
      type: "bar",
      borderRadius: 8,
      backgroundColor: chartLogs.map((log) =>
        Number(log.accel) >= 0 ? "rgba(31, 201, 122, 0.75)" : "rgba(255, 93, 93, 0.75)"
      ),
    }
  );
}

function renderLogs(logs) {
  viewEls.loadingState.classList.add("hidden");
  viewEls.logList.innerHTML = "";

  if (!logs.length) {
    viewEls.emptyState.classList.remove("hidden");
    renderSummary([]);
    renderInsights([]);
    renderAnomalies([]);
    renderCharts([]);
    return;
  }

  viewEls.emptyState.classList.add("hidden");
  renderSummary(logs);
  renderInsights(logs);
  renderAnomalies(logs);
  renderCharts(logs);

  viewEls.logList.innerHTML = logs
    .map((log) => {
      const logClass = levelClass(log.normalizedLevel);
      const timestampText = formatTimestamp(log.timestamp, log.timestampText || "-");
      const anomalyBadge = log.anomalyReasons.length
        ? `<span class="alert-tag">ANOMALY</span>`
        : "";

      return `
        <article class="log-item ${logClass} ${log.anomalyReasons.length ? "anomaly-log" : ""}">
          <div class="log-top">
            <div class="log-meta-left">
              <span class="level-badge ${logClass}">${escapeHtml(log.normalizedLevel)}</span>
              ${anomalyBadge}
              <span class="timestamp">${escapeHtml(timestampText)}</span>
              <span class="user-chip">${escapeHtml(log.user || "unknown")}</span>
            </div>
          </div>

          <div class="log-message">${escapeHtml(log.message || log.rawLog || "(no message)")}</div>
          ${
            log.anomalyReasons.length
              ? `<div class="anomaly-inline">${escapeHtml(log.anomalyReasons.join(" / "))}</div>`
              : ""
          }

          <div class="log-detail-grid">
            ${createDetailBox("EVENT", log.event)}
            ${createDetailBox("IMPACT", log.impact)}
            ${createDetailBox("BRAKE", log.brake)}
            ${createDetailBox("SPEED", formatNumber(log.speed, 0, " km/h"))}
            ${createDetailBox("ACCEL", formatNumber(log.accel, 2, " m/s2"))}
            ${createDetailBox("DIST", formatNumber(log.dist, 1, " km"))}
            ${createDetailBox("FUEL", formatNumber(log.fuelEff, 1, " km/L"))}
            ${createDetailBox("ENG TEMP", formatNumber(log.engTemp, 0, " C"))}
            ${createDetailBox("G FORCE", formatNumber(log.gForce, 2, " G"))}
            ${createDetailBox("LOCATION", log.location || log.locationText)}
          </div>
        </article>
      `;
    })
    .join("");
}

function populateUserSelect(logs = latestSnapshotDocs.map(toLog)) {
  const previousValue = formEls.userId.value;
  const usersFromProfiles = currentProfiles.map((profile) => profile.uid);
  const usersFromLogs = logs.map((log) => log.user).filter(Boolean);
  const users = [...new Set([...usersFromProfiles, ...usersFromLogs])].sort((a, b) =>
    a.localeCompare(b, "ko")
  );

  const options = ['<option value="">All users</option>']
    .concat(
      users.map((userId) => {
        const profile = currentProfiles.find((item) => item.uid === userId);
        const label = profile?.displayName ? `${profile.displayName} (${userId})` : userId;
        return `<option value="${escapeHtml(userId)}">${escapeHtml(label)}</option>`;
      })
    )
    .join("");

  formEls.userId.innerHTML = options;
  if (users.includes(previousValue)) {
    formEls.userId.value = previousValue;
  }
}

function setQueryStatus(filters, logs = []) {
  const lines = [
    `Collection: ${COLLECTION_NAME}`,
    `Level: ${filters.logLevel}`,
    `User ID: ${filters.userId || "ALL"}`,
    `Keyword: ${filters.keyword || "none"}`,
    `Start: ${filters.startDate || "none"}`,
    `End: ${filters.endDate || "none"}`,
    `Sort: timestamp desc`,
    `Limit: ${MAX_DOCS}`,
    `Rendered: ${logs.length}`,
    `Updated: ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`,
  ];

  viewEls.queryStatus.textContent = lines.join("\n");
}

async function loadProfiles() {
  try {
    currentProfiles = await listProfiles();
  } catch (error) {
    console.warn("Failed to load user profiles:", error);
    currentProfiles = [];
  }

  populateUserSelect();
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
  setRealtimeBadge("Realtime syncing");

  const q = buildFirestoreQuery(filters);

  unsubscribeLogs = onSnapshot(
    q,
    (snapshot) => {
      latestSnapshotDocs = snapshot.docs;
      populateUserSelect();
      const logs = applyClientFilters(snapshot.docs, filters);
      renderLogs(logs);
      setQueryStatus(filters, logs);
      setRealtimeBadge(`Realtime synced: ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`);
    },
    (error) => {
      console.error(error);
      viewEls.loadingState.classList.add("hidden");
      viewEls.emptyState.classList.remove("hidden");
      viewEls.emptyState.textContent = `Failed to load logs: ${error.message}`;
      renderSummary([]);
      renderInsights([]);
      renderAnomalies([]);
      setRealtimeBadge("Realtime error", false);
    }
  );
}

async function uploadLinesInBatches(fileName, lines) {
  let uploadedCount = 0;

  for (let index = 0; index < lines.length; index += BATCH_SIZE) {
    const chunk = lines.slice(index, index + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach((line, offset) => {
      const ref = doc(collection(db, RAW_COLLECTION_NAME));
      batch.set(ref, {
        rawLog: line,
        fileName,
        lineNumber: index + offset + 1,
        status: "uploaded",
        uploadedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    uploadedCount += chunk.length;

    setUploadStatus(
      [
        "Uploading.",
        `File: ${fileName}`,
        `Total lines: ${lines.length}`,
        `Completed: ${uploadedCount}/${lines.length}`,
      ].join("\n")
    );
  }
}

async function handleRawLogUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    setUploadStatus(`Reading file.\nFile: ${file.name}`);

    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      setUploadStatus("No logs were found in the selected file.");
      return;
    }

    localStorage.setItem("sharedDrivingData", lines.slice(-50).join("\n"));
    await uploadLinesInBatches(file.name, lines);

    setUploadStatus(
      [
        "Upload completed",
        `File: ${file.name}`,
        `Total lines: ${lines.length}`,
        "",
        "Stored in raw_telematics_logs.",
        "Cloud Functions will parse and reflect them into telematics_logs.",
      ].join("\n")
    );
  } catch (error) {
    console.error(error);
    setUploadStatus(`Upload failed\n${error.message}`);
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

  formEls.userId.addEventListener("change", subscribeLogs);
  formEls.logLevel.addEventListener("change", subscribeLogs);

  if (formEls.rawLogFile) {
    formEls.rawLogFile.addEventListener("change", handleRawLogUpload);
  }
}

bindEvents();
loadProfiles();
subscribeLogs();
setUploadStatus("Waiting for upload.");
