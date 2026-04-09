import {
  listProfiles,
  setUserRole,
  updateOwnProfileSettings,
  watchSession,
} from "../auth/auth-service.js";
import { appConfig } from "../config/app-config.js";

const adminSidebar = document.getElementById("adminSidebar");
const sidebarButtons = Array.from(document.querySelectorAll(".sidebar-btn"));
const profileSection = document.getElementById("profileSection");
const memberSection = document.getElementById("memberSection");
const profileDescription = document.getElementById("profileDescription");
const profileForm = document.getElementById("profileForm");
const displayNameInput = document.getElementById("displayName");
const newPasswordInput = document.getElementById("newPassword");
const newPasswordConfirmInput = document.getElementById("newPasswordConfirm");
const profileImageInput = document.getElementById("profileImage");
const backgroundImageInput = document.getElementById("backgroundImage");
const profilePreview = document.getElementById("profilePreview");
const backgroundPreview = document.getElementById("backgroundPreview");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const memberList = document.getElementById("memberList");
const vehicleStatus = document.getElementById("vehicleStatus");

let currentSession = null;
const TEMP_ADMIN_EMAIL = appConfig.auth.tempAdminEmail;

function setStatus(message) {
  vehicleStatus.textContent = message;
}

function refreshMainView() {
  if (window.parent && window.parent !== window) {
    window.parent.location.reload();
    return;
  }

  window.location.reload();
}

function togglePreview(input, previewEl) {
  const file = input.files?.[0];
  if (!file) {
    previewEl.classList.add("hidden");
    previewEl.removeAttribute("src");
    return;
  }

  previewEl.src = URL.createObjectURL(file);
  previewEl.classList.remove("hidden");
}

function setActiveView(viewName) {
  profileSection.classList.toggle("hidden", viewName !== "profile");
  memberSection.classList.toggle("hidden", viewName !== "members");

  sidebarButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function applyProfileState(session) {
  displayNameInput.value = session?.displayName || "";
  const isDefault = !!session?.isDefault;

  if (session?.photoURL) {
    profilePreview.src = session.photoURL;
    profilePreview.classList.remove("hidden");
  } else {
    profilePreview.classList.add("hidden");
  }

  if (session?.backgroundImageUrl) {
    backgroundPreview.src = session.backgroundImageUrl;
    backgroundPreview.classList.remove("hidden");
  } else {
    backgroundPreview.classList.add("hidden");
  }

  displayNameInput.disabled = isDefault;
  displayNameInput.readOnly = isDefault;
  newPasswordInput.disabled = isDefault;
  newPasswordInput.readOnly = isDefault;
  newPasswordConfirmInput.disabled = isDefault;
  newPasswordConfirmInput.readOnly = isDefault;
  profileImageInput.disabled = isDefault;
  backgroundImageInput.disabled = isDefault;
  saveProfileBtn.disabled = isDefault;
  saveProfileBtn.textContent = isDefault ? "수정 불가" : "저장";

  if (isDefault) {
    profileDescription.textContent = "기본 SSAFY 계정은 닉네임, 비밀번호, 배경화면, 프로필 이미지를 수정할 수 없습니다.";
  } else if (session?.role === "user") {
    profileDescription.textContent = "일반 사용자는 자신의 닉네임, 비밀번호, 배경화면, 프로필 이미지를 수정할 수 있습니다.";
  } else {
    profileDescription.textContent = "관리자 계정 정보입니다.";
  }
}

function createRoleButton(label, uid, role) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "role-btn";
  button.textContent = label;
  button.addEventListener("click", async () => {
    setStatus("권한을 변경하는 중입니다.");
    try {
      await setUserRole(uid, role);
      await loadMemberList();
      setStatus("권한이 변경되었습니다.");
    } catch (error) {
      console.error(error);
      setStatus("권한 변경에 실패했습니다.");
    }
  });
  return button;
}

async function loadMemberList() {
  const isAdmin = !!currentSession && (currentSession.role === "admin" || currentSession.email === TEMP_ADMIN_EMAIL);
  if (!isAdmin) {
    memberList.innerHTML = "";
    return;
  }

  const profiles = await listProfiles();
  memberList.innerHTML = "";

  profiles.forEach((profile) => {
    if (profile.uid === currentSession.uid) return;

    const card = document.createElement("article");
    card.className = "member-card";
    card.innerHTML = `
      <strong>${profile.displayName}</strong>
      <span>${profile.email || "기본 계정"}</span>
      <span>현재 권한: ${profile.role}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "member-actions";

    if (!profile.isDefault) {
      actions.appendChild(createRoleButton("일반 사용자", profile.uid, "user"));
      actions.appendChild(createRoleButton("관리자", profile.uid, "admin"));
    }

    card.appendChild(actions);
    memberList.appendChild(card);
  });
}

sidebarButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveView(button.dataset.view);
  });
});

profileImageInput.addEventListener("change", () => {
  togglePreview(profileImageInput, profilePreview);
});

backgroundImageInput.addEventListener("change", () => {
  togglePreview(backgroundImageInput, backgroundPreview);
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentSession) return;
  if (currentSession.isDefault) {
    setStatus("기본 SSAFY 계정은 정보를 수정할 수 없습니다.");
    return;
  }

  const displayName = displayNameInput.value.trim();
  const newPassword = newPasswordInput.value.trim();
  const newPasswordConfirm = newPasswordConfirmInput.value.trim();

  if (newPassword || newPasswordConfirm) {
    if (newPassword !== newPasswordConfirm) {
      setStatus("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (newPassword.length < 6) {
      setStatus("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
  }

  setStatus("프로필을 저장하는 중입니다.");
  const result = await updateOwnProfileSettings({
    displayName,
    newPassword,
    profileImageFile: profileImageInput.files?.[0] || null,
    backgroundImageFile: backgroundImageInput.files?.[0] || null,
  });

  if (result === "auth/requires-recent-login") {
    setStatus("비밀번호 변경 전 다시 로그인해야 합니다.");
    return;
  }

  if (result !== true) {
    setStatus("프로필 저장에 실패했습니다.");
    return;
  }

  setStatus("프로필이 저장되었습니다.");
  refreshMainView();
});

watchSession(async (session) => {
  currentSession = session;

  if (!session) {
    setStatus("로그인 정보를 확인할 수 없습니다.");
    return;
  }

  const isAdmin = session.role === "admin" || session.email === TEMP_ADMIN_EMAIL;
  adminSidebar.classList.toggle("hidden", !isAdmin);
  setActiveView(session.isDefault ? "profile" : isAdmin ? "members" : "profile");
  applyProfileState(session);

  if (isAdmin) {
    await loadMemberList();
    setStatus("관리자 기능을 사용할 수 있습니다.");
    return;
  }

  setStatus("내 프로필을 수정할 수 있습니다.");
});
