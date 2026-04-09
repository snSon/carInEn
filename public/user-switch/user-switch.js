import {
  checkEmailAvailability,
  listProfiles,
  loginWithEmail,
  logoutToSsafy,
  quickAccessSsafy,
  signupProfile,
} from "../auth/auth-service.js";
import { assetUrls } from "../config/asset-urls.js";

const profileGrid = document.getElementById("profileGrid");
const switchStatus = document.getElementById("switchStatus");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const selectedProfileText = document.getElementById("selectedProfileText");
const addProfileBtn = document.getElementById("addProfileBtn");
const cancelLoginBtn = document.getElementById("cancelLoginBtn");
const signupForm = document.getElementById("signupForm");
const signupName = document.getElementById("signupName");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const signupPasswordConfirm = document.getElementById("signupPasswordConfirm");
const signupProfileImage = document.getElementById("signupProfileImage");
const signupEmailStatus = document.getElementById("signupEmailStatus");
const signupSubmitBtn = document.getElementById("signupSubmitBtn");
const cancelSignupBtn = document.getElementById("cancelSignupBtn");
const logoutBtn = document.getElementById("logoutBtn");

let selectedProfile = null;
let emailCheckToken = 0;
let isSignupEmailAvailable = false;

function setStatus(message) {
  switchStatus.textContent = message;
}

function markHomeInitialized() {
  sessionStorage.setItem("pjt5-home-initialized", "true");
}

function goMain() {
  markHomeInitialized();
  if (window.parent && window.parent !== window) {
    window.parent.location.reload();
    return;
  }

  window.location.href = "../index.html";
}

function openLoginPanel(profile) {
  selectedProfile = profile;
  signupForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  loginEmail.value = profile.email || "";
  loginPassword.value = "";
  selectedProfileText.textContent = `${profile.displayName} 계정 로그인`;
}

function closeLoginPanel() {
  selectedProfile = null;
  loginForm.classList.add("hidden");
  loginEmail.value = "";
  loginPassword.value = "";
  selectedProfileText.textContent = "";
}

function openSignupPanel() {
  closeLoginPanel();
  signupForm.classList.remove("hidden");
}

function closeSignupPanel() {
  signupForm.classList.add("hidden");
  signupForm.reset();
  signupEmailStatus.textContent = "";
  signupEmailStatus.classList.remove("error");
  signupSubmitBtn.disabled = false;
  isSignupEmailAvailable = false;
}

async function validateSignupEmail() {
  const email = signupEmail.value.trim();
  const currentToken = ++emailCheckToken;

  if (!email) {
    signupEmailStatus.textContent = "";
    signupEmailStatus.classList.remove("error");
    signupSubmitBtn.disabled = false;
    isSignupEmailAvailable = false;
    return;
  }

  signupEmailStatus.textContent = "이메일 중복 여부를 확인하는 중입니다.";
  signupEmailStatus.classList.remove("error");
  signupSubmitBtn.disabled = true;

  const result = await checkEmailAvailability(email);
  if (currentToken !== emailCheckToken) return;

  if (result === true) {
    signupEmailStatus.textContent = "사용 가능한 이메일입니다.";
    signupEmailStatus.classList.remove("error");
    signupSubmitBtn.disabled = false;
    isSignupEmailAvailable = true;
    return;
  }

  signupEmailStatus.textContent = "이미 가입된 이메일입니다.";
  signupEmailStatus.classList.add("error");
  signupSubmitBtn.disabled = true;
  isSignupEmailAvailable = false;
}

async function handleProfileSelect(profile) {
  if (!profile.requiresLogin) {
    setStatus("기본 SSAFY 계정으로 전환 중입니다.");
    try {
      await quickAccessSsafy();
    } catch (error) {
      console.warn("SSAFY quick access warning:", error);
    }
    goMain();
    return;
  }

  openLoginPanel(profile);
}

function createProfileCard(profile) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile-card";

  const hasCustomProfile = !!profile.photoURL;
  const imageSrc = profile.photoURL || assetUrls.defaultProfile;
  const emailText = profile.email || "기본 계정";
  const modeText = profile.requiresLogin ? "로그인 필요" : "즉시 진입 가능";
  const roleText = `권한: ${profile.role}`;

  button.innerHTML = `
    <img class="profile-avatar${hasCustomProfile ? "" : " default-avatar"}" src="${imageSrc}" alt="${profile.displayName}">
    <strong>${profile.displayName}</strong>
    <span>${emailText}</span>
    <span>${roleText}</span>
    <span>${modeText}</span>
  `;

  button.addEventListener("click", () => {
    handleProfileSelect(profile).catch((error) => {
      console.error(error);
      setStatus("프로필 전환에 실패했습니다.");
    });
  });

  return button;
}

async function loadProfileList() {
  try {
    const profiles = await listProfiles();
    profileGrid.innerHTML = "";

    profiles.forEach((profile) => {
      profileGrid.appendChild(createProfileCard(profile));
    });

    setStatus("프로필을 선택하세요.");
  } catch (error) {
    console.error(error);
    setStatus("프로필 목록을 불러오지 못했습니다.");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!selectedProfile || !selectedProfile.email) return;

  const password = loginPassword.value.trim();
  if (!password) {
    setStatus("비밀번호를 입력하세요.");
    return;
  }

  setStatus("로그인 중입니다.");
  const result = await loginWithEmail(selectedProfile.email, password);

  if (result === "auth/invalid-credential") {
    setStatus("이메일 또는 비밀번호가 올바르지 않습니다.");
    return;
  }

  if (result === "auth/invalid-email") {
    setStatus("유효한 이메일 형식이 아닙니다.");
    return;
  }

  if (result !== true) {
    setStatus("로그인에 실패했습니다.");
    return;
  }

  setStatus("로그인에 성공했습니다.");
  goMain();
}

async function handleSignup(event) {
  event.preventDefault();

  const displayName = signupName.value.trim();
  const email = signupEmail.value.trim();
  const password = signupPassword.value.trim();
  const passwordConfirm = signupPasswordConfirm.value.trim();
  const imageFile = signupProfileImage.files?.[0] || null;

  if (!displayName || !email || !password || !passwordConfirm) {
    setStatus("모든 필수 항목을 입력하세요.");
    return;
  }

  if (!isSignupEmailAvailable) {
    setStatus("이메일 중복 여부를 먼저 확인하세요.");
    return;
  }

  if (password !== passwordConfirm) {
    setStatus("비밀번호가 일치하지 않습니다.");
    return;
  }

  setStatus("프로필을 생성하는 중입니다.");
  const result = await signupProfile({ email, password, displayName, imageFile });

  if (result === "auth/invalid-email") {
    setStatus("유효한 이메일 형식이 아닙니다.");
    return;
  }

  if (result === "auth/weak-password") {
    setStatus("비밀번호는 6자 이상이어야 합니다.");
    return;
  }

  if (result === "auth/email-already-in-use") {
    setStatus("이미 등록된 이메일입니다.");
    return;
  }

  if (result !== true) {
    setStatus("프로필 생성에 실패했습니다.");
    return;
  }

  setStatus("프로필 생성이 완료되었습니다.");
  goMain();
}

addProfileBtn.addEventListener("click", openSignupPanel);
signupEmail.addEventListener("input", () => {
  isSignupEmailAvailable = false;
  validateSignupEmail();
});
logoutBtn.addEventListener("click", async () => {
  setStatus("기본 SSAFY 계정으로 전환 중입니다.");
  try {
    await logoutToSsafy();
  } catch (error) {
    console.warn("Logout to SSAFY warning:", error);
  }
  goMain();
});
cancelLoginBtn.addEventListener("click", closeLoginPanel);
cancelSignupBtn.addEventListener("click", closeSignupPanel);
loginForm.addEventListener("submit", handleLogin);
signupForm.addEventListener("submit", handleSignup);

loadProfileList();
