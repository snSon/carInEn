const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const runtimeConfig = require("./config/runtime-config");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();
const { Timestamp, FieldValue } = admin.firestore;

const DEFAULT_SSAFY_UID = runtimeConfig.auth.defaultSsafyUid;
const DEFAULT_SSAFY_PROFILE = {
  uid: DEFAULT_SSAFY_UID,
  displayName: "SSAFY",
  email: null,
  photoURL: null,
  role: "admin",
  isDefault: true,
};
const TEMP_ADMIN_EMAIL = runtimeConfig.auth.tempAdminEmail;

async function getStoredRole(uid) {
  const snapshot = await db.collection("user_preferences").doc(uid).get();
  const role = snapshot.data()?.role;
  return role === "admin" || role === "user" ? role : null;
}

async function syncUserRolePreference(uid, role) {
  await db.collection("user_preferences").doc(uid).set(
    {
      role,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function ensureRoleClaim(userRecord) {
  const isDefault = userRecord.uid === DEFAULT_SSAFY_UID;
  const storedRole = await getStoredRole(userRecord.uid);
  const claimedRole =
    userRecord.customClaims?.role === "admin" || userRecord.customClaims?.role === "user"
      ? userRecord.customClaims.role
      : null;
  const targetRole =
    isDefault || userRecord.email === TEMP_ADMIN_EMAIL
      ? "admin"
      : storedRole || claimedRole || "user";
  const currentRole = userRecord.customClaims?.role;

  if (currentRole === targetRole) {
    await syncUserRolePreference(userRecord.uid, targetRole);
    return userRecord;
  }

  await auth.setCustomUserClaims(userRecord.uid, {
    ...(userRecord.customClaims || {}),
    role: targetRole,
  });

  await syncUserRolePreference(userRecord.uid, targetRole);

  return auth.getUser(userRecord.uid);
}

async function ensureDefaultSsafyUser() {
  let userRecord;

  try {
    userRecord = await auth.getUser(DEFAULT_SSAFY_UID);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }

    userRecord = await auth.createUser({
      uid: DEFAULT_SSAFY_UID,
      displayName: DEFAULT_SSAFY_PROFILE.displayName,
    });
  }

  return ensureRoleClaim(userRecord);
}

function toProfile(userRecord) {
  const isDefault = userRecord.uid === DEFAULT_SSAFY_UID;
  const role = isDefault ? "admin" : userRecord.customClaims?.role === "admin" ? "admin" : "user";

  return {
    uid: userRecord.uid,
    displayName:
      userRecord.displayName ||
      userRecord.email ||
      (isDefault ? DEFAULT_SSAFY_PROFILE.displayName : "User"),
    email: userRecord.email || null,
    photoURL: userRecord.photoURL || null,
    requiresLogin: !isDefault,
    role,
    isDefault,
  };
}

function parseKstTimestamp(timestampText) {
  if (!timestampText) return null;

  const iso = String(timestampText).replace(" ", "T") + "+09:00";
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

function extractNumber(text, regex) {
  const match = text.match(regex);
  if (!match || match[1] == null || match[1] === "") return null;

  const num = Number(match[1]);
  return Number.isNaN(num) ? null : num;
}

function extractText(text, regex) {
  const match = text.match(regex);
  if (!match || match[1] == null) return null;

  const value = String(match[1]).trim();
  return value === "" ? null : value;
}

function parseLocation(text) {
  const match = text.match(/Location=([-\d.]+),([-\d.]+)/);
  if (!match) {
    return {
      locationText: null,
      latitude: null,
      longitude: null,
    };
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);

  return {
    locationText: `${match[1]},${match[2]}`,
    latitude: Number.isNaN(lat) ? null : lat,
    longitude: Number.isNaN(lng) ? null : lng,
  };
}

function parseRawLogLine(rawLine) {
  if (!rawLine || typeof rawLine !== "string") {
    return {
      parseStatus: "failed",
      reason: "rawLine is empty",
      timestamp: null,
      timestampText: null,
      user: null,
      logLevel: null,
      event: null,
      impact: null,
      speed: null,
      accel: null,
      brake: null,
      dist: null,
      engTemp: null,
      fuelEff: null,
      gForce: null,
      latitude: null,
      longitude: null,
      locationText: null,
      message: null,
      missingFields: ["rawLine"],
    };
  }

  const cleaned = rawLine.trim();
  const bodyLine = cleaned.startsWith("[") ? cleaned.slice(1) : cleaned;
  const parts = bodyLine.split("|").map((part) => part.trim());

  if (parts.length < 4) {
    return {
      parseStatus: "failed",
      reason: "header split failed",
      rawLine: cleaned,
      timestamp: null,
      timestampText: null,
      user: null,
      logLevel: null,
      event: null,
      impact: null,
      speed: null,
      accel: null,
      brake: null,
      dist: null,
      engTemp: null,
      fuelEff: null,
      gForce: null,
      latitude: null,
      longitude: null,
      locationText: null,
      message: cleaned,
      missingFields: ["timestamp", "user", "logLevel"],
    };
  }

  const timestampText = parts[0];
  const user = parts[1];
  const logLevel = parts[2];
  const body = parts.slice(3).join(" | ").trim();

  const event = extractText(body, /Event=([A-Za-z]+)/);
  const impact = extractText(body, /Impact=([A-Za-z]+)/);
  const brake = extractText(body, /Brake=(ON|OFF)/);

  const speed = extractNumber(body, /Speed=(-?\d+(?:\.\d+)?)\s*km\/h/);
  const accel = extractNumber(body, /Accel=(-?\d+(?:\.\d+)?)/);
  const dist = extractNumber(body, /Dist=(-?\d+(?:\.\d+)?)\s*km/);
  const engTemp = extractNumber(body, /EngTemp=(-?\d+(?:\.\d+)?)/);
  const fuelEff = extractNumber(body, /FuelEff=(-?\d+(?:\.\d+)?)\s*km\/L/);
  const gForce = extractNumber(body, /GForce=(-?\d+(?:\.\d+)?)G/);

  const location = parseLocation(body);
  const timestamp = parseKstTimestamp(timestampText);

  const missingFields = [];
  if (!timestamp) missingFields.push("timestamp");
  if (!user) missingFields.push("user");
  if (!logLevel) missingFields.push("logLevel");

  const parsed = {
    timestampText: timestampText || null,
    timestamp,
    user: user || null,
    logLevel: logLevel || null,
    event,
    impact,
    speed,
    accel,
    brake,
    dist,
    engTemp,
    fuelEff,
    gForce,
    latitude: location.latitude,
    longitude: location.longitude,
    locationText: location.locationText,
    message: body || null,
    missingFields,
  };

  const topLevelRequiredOk = !!(parsed.user && parsed.logLevel);
  parsed.parseStatus = topLevelRequiredOk ? "success" : "partial";

  return parsed;
}

exports.listProfiles = onCall(async () => {
  await ensureDefaultSsafyUser();

  const profiles = [];
  let nextPageToken = undefined;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    for (const rawUserRecord of result.users) {
      const userRecord = await ensureRoleClaim(rawUserRecord);
      profiles.push(toProfile(userRecord));
    }
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  profiles.sort((a, b) => {
    if (a.uid === DEFAULT_SSAFY_UID) return -1;
    if (b.uid === DEFAULT_SSAFY_UID) return 1;
    return a.displayName.localeCompare(b.displayName, "ko");
  });

  return { profiles };
});

exports.quickAccessSsafy = onCall(async () => {
  try {
    const userRecord = await ensureDefaultSsafyUser();
    const customToken = await auth.createCustomToken(userRecord.uid, {
      role: "admin",
      profileType: "default",
    });

    return {
      customToken,
      profile: toProfile(userRecord),
    };
  } catch (error) {
    logger.error("quickAccessSsafy failed", error);
    throw new HttpsError("internal", "Failed to create SSAFY quick access token.");
  }
});

exports.setUserRole = onCall(async (request) => {
  const caller = request.auth;
  const { uid, role } = request.data || {};

  if (!caller || caller.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  if (!uid || !["user", "admin"].includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role request");
  }

  if (uid === DEFAULT_SSAFY_UID) {
    throw new HttpsError("failed-precondition", "Default SSAFY account role cannot be changed");
  }

  await auth.setCustomUserClaims(uid, { role });
  await syncUserRolePreference(uid, role);
  const userRecord = await auth.getUser(uid);

  return {
    profile: toProfile(userRecord),
  };
});

exports.processRawTelematicsLog = onDocumentCreated(
  "raw_telematics_logs/{docId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const rawData = snapshot.data();
    const rawLog = rawData.rawLog || rawData.log || "";

    logger.info("raw log received", {
      rawRefId: snapshot.id,
      fileName: rawData.fileName || null,
      lineNumber: rawData.lineNumber || null,
    });

    const parsed = parseRawLogLine(rawLog);

    await db.collection("telematics_logs").doc(snapshot.id).set({
      rawRefId: snapshot.id,
      rawLog,
      fileName: rawData.fileName || null,
      lineNumber: rawData.lineNumber || null,
      uploadedAt: rawData.uploadedAt || null,
      ...parsed,
      createdAt: FieldValue.serverTimestamp(),
    });

    await snapshot.ref.update({
      status: "parsed",
      parsedAt: FieldValue.serverTimestamp(),
    });
  }
);
