import { appConfig } from "./app-config.js";

let kakaoLoaderPromise = null;

export function loadKakaoSdk(configuredKey = appConfig.kakao?.dashboardJavascriptKey) {
  if (window.kakao?.maps) {
    return Promise.resolve(window.kakao);
  }

  if (kakaoLoaderPromise) {
    return kakaoLoaderPromise;
  }

  kakaoLoaderPromise = new Promise((resolve, reject) => {
    const javascriptKey = configuredKey;

    if (!javascriptKey || javascriptKey.includes("YOUR_")) {
      reject(new Error("Kakao JavaScript key is not configured."));
      return;
    }

    const script = document.createElement("script");
    script.src =
      `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=` +
      encodeURIComponent(javascriptKey);
    script.onload = () => {
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    script.onerror = () => {
      reject(new Error("Failed to load Kakao Maps SDK."));
    };
    document.head.appendChild(script);
  });

  return kakaoLoaderPromise;
}
