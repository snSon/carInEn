import { auth, db, functions, storage } from "../firebase/firebase-config.js";
import { appConfig } from "../config/app-config.js";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getIdTokenResult,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-functions.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  getDownloadURL,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

const DEFAULT_SSAFY_UID = appConfig.auth.defaultSsafyUid;
const TEMP_ADMIN_EMAIL = appConfig.auth.tempAdminEmail;

const listProfilesCallable = httpsCallable(functions, "listProfiles");
const quickAccessCallable = httpsCallable(functions, "quickAccessSsafy");
const setUserRoleCallable = httpsCallable(functions, "setUserRole");

function isDefaultSsafyUser(user) {
  return !!user && user.uid === DEFAULT_SSAFY_UID;
}

function resolveRole(user, tokenResult) {
  if (!user) return null;
  if (isDefaultSsafyUser(user)) return "admin";
  if (user.email === TEMP_ADMIN_EMAIL) return "admin";
  return tokenResult?.claims?.role === "admin" ? "admin" : "user";
}

function resolveEffectiveRole(user, tokenResult, preference) {
  if (!user) return null;

  if (isDefaultSsafyUser(user)) return "admin";
  if (user.email === TEMP_ADMIN_EMAIL) return "admin";

  if (preference?.role === "admin" || preference?.role === "user") {
    return preference.role;
  }

  return resolveRole(user, tokenResult);
}

async function getUserPreference(uid) {
  const snapshot = await getDoc(doc(db, "user_preferences", uid));
  return snapshot.exists() ? snapshot.data() : {};
}

async function buildSession(user) {
  if (!user) return null;

  const tokenResult = await getIdTokenResult(user, true);
  const preference = await getUserPreference(user.uid);
  const role = resolveEffectiveRole(user, tokenResult, preference);

  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || user.email || "사용자",
    photoURL: user.photoURL || null,
    role,
    isDefault: isDefaultSsafyUser(user),
    canUseChatbot: role === "user",
    backgroundImageUrl: preference.backgroundImageUrl || null,
  };
}

async function listProfiles() {
  const result = await listProfilesCallable();
  return result.data.profiles || [];
}

async function quickAccessSsafy() {
  if (auth.currentUser) {
    await signOut(auth);
  }
  const result = await quickAccessCallable();
  const { customToken, profile } = result.data;
  await signInWithCustomToken(auth, customToken);
  return profile;
}

async function loginWithEmail(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    return true;
  } catch (error) {
    return error.code;
  }
}

async function checkEmailAvailability(email) {
  try {
    const methods = await fetchSignInMethodsForEmail(auth, email);
    return methods.length === 0;
  } catch (error) {
    return error.code || false;
  }
}

async function signupProfile({ email, password, displayName, imageFile }) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const updates = {};

    if (displayName) {
      updates.displayName = displayName;
    }

    if (imageFile) {
      const timestamp = Date.now();
      const safeName = String(imageFile.name || "profile").replace(/\s+/g, "_");
      const imageRef = ref(storage, `profile-images/${userCredential.user.uid}/${timestamp}_${safeName}`);
      await uploadBytes(imageRef, imageFile);
      updates.photoURL = await getDownloadURL(imageRef);
    }

    if (Object.keys(updates).length > 0) {
      await updateProfile(userCredential.user, updates);
    }

    await userCredential.user.getIdToken(true);

    await setDoc(
      doc(db, "user_preferences", userCredential.user.uid),
      {
        role: "user",
        backgroundImageUrl: "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return true;
  } catch (error) {
    return error.code;
  }
}

async function updateOwnProfileSettings({
  displayName,
  newPassword,
  profileImageFile,
  backgroundImageFile,
}) {
  const user = auth.currentUser;
  if (!user) {
    return "auth/no-current-user";
  }

  try {
    const updates = {};

    if (displayName) {
      updates.displayName = displayName;
    }

    if (profileImageFile) {
      const timestamp = Date.now();
      const safeName = String(profileImageFile.name || "profile").replace(/\s+/g, "_");
      const imageRef = ref(storage, `profile-images/${user.uid}/${timestamp}_${safeName}`);
      await uploadBytes(imageRef, profileImageFile);
      updates.photoURL = await getDownloadURL(imageRef);
    }

    if (Object.keys(updates).length > 0) {
      await updateProfile(user, updates);
    }

    if (newPassword) {
      await updatePassword(user, newPassword);
    }

    let backgroundImageUrl = null;
    if (backgroundImageFile) {
      const timestamp = Date.now();
      const safeName = String(backgroundImageFile.name || "background").replace(/\s+/g, "_");
      const imageRef = ref(storage, `background-images/${user.uid}/${timestamp}_${safeName}`);
      await uploadBytes(imageRef, backgroundImageFile);
      backgroundImageUrl = await getDownloadURL(imageRef);
    }

    if (backgroundImageUrl !== null) {
      await setDoc(
        doc(db, "user_preferences", user.uid),
        {
          backgroundImageUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await user.reload();
    await user.getIdToken(true);

    return true;
  } catch (error) {
    return error.code || "profile/update-failed";
  }
}

async function setUserRole(uid, role) {
  const result = await setUserRoleCallable({ uid, role });
  return result.data;
}

async function logoutCurrentUser() {
  try {
    await signOut(auth);
    return true;
  } catch (error) {
    return error.code;
  }
}

async function logoutToSsafy() {
  await signOut(auth);
  return quickAccessSsafy();
}

function watchSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    try {
      callback(await buildSession(user));
    } catch (error) {
      console.error("Failed to build session:", error);
      callback(null);
    }
  });
}

export {
  DEFAULT_SSAFY_UID,
  isDefaultSsafyUser,
  listProfiles,
  checkEmailAvailability,
  loginWithEmail,
  logoutCurrentUser,
  logoutToSsafy,
  quickAccessSsafy,
  setUserRole,
  signupProfile,
  updateOwnProfileSettings,
  watchSession,
};
