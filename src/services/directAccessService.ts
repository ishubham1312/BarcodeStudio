import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot
} from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyD-ch9_l0Ch15CbLtM4Xy2qGOZbyXgyz9M",
  authDomain: "barcodestudio.firebaseapp.com",
  projectId: "barcodestudio",
  storageBucket: "barcodestudio.firebasestorage.app",
  messagingSenderId: "448309891073",
  appId: "1:448309891073:web:1841945341ccc924efb000"
};

export const APP_METADATA = {
  appId: "bcs",
  appName: "barcode",
  apiKey: "app_sec_live_barcode_key",
  version: "3.8.2",
  platform: "desktop"
};

export type DirectAccessMode = "active" | "deactivated" | "paused";

export interface LockScreenState {
  isLocked: boolean;
  mode: DirectAccessMode;
  title: string;
  message: string;
  type: "admin_notice" | "fake_error";
  hardwareId?: string;
  hostname?: string;
  username?: string;
  os?: string;
  lastPingAt?: string;
}

export interface SystemInfo {
  hardwareId: string;
  hostname: string;
  username: string;
  os: string;
  platform: string;
}

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);

export async function ensureAppDocumentExists() {
  try {
    const appRef = doc(db, "apps", APP_METADATA.appId);
    const snap = await getDoc(appRef);
    const now = new Date().toISOString();

    if (!snap.exists()) {
      await setDoc(appRef, {
        id: APP_METADATA.appId,
        slug: APP_METADATA.appId,
        name: "Barcode",
        appName: APP_METADATA.appName,
        apiKey: APP_METADATA.apiKey,
        version: APP_METADATA.version,
        platform: APP_METADATA.platform,
        status: "active",
        authType: "direct-access",
        description: "Barcode Studio Desktop Suite with Direct Access",
        fakeErrorMessage: "Database connection error (ERR_CONN_TIMEOUT_0x8401): Remote cluster unreachable. Retrying in background...",
        heartbeatIntervalSec: 30,
        createdAt: now,
        lastHeartbeat: now
      }, { merge: true });
    } else {
      await updateDoc(appRef, {
        lastHeartbeat: now,
        version: APP_METADATA.version
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[DirectAccess] Failed ensuring app document:", err);
  }
}

export async function registerDevice(systemInfo: SystemInfo): Promise<void> {
  const instanceDocId = `${APP_METADATA.appId}_${systemInfo.hardwareId}`;
  const instanceRef = doc(db, "app_instances", instanceDocId);

  try {
    const snap = await getDoc(instanceRef);
    const now = new Date().toISOString();

    if (!snap.exists()) {
      // First time registration: default deviceMode='deactivated', accessGranted=false
      await setDoc(instanceRef, {
        appId: APP_METADATA.appId,
        appName: APP_METADATA.appName,
        instanceId: systemInfo.hardwareId,
        hostname: systemInfo.hostname,
        username: systemInfo.username,
        platform: systemInfo.platform,
        os: systemInfo.os,
        appVersion: APP_METADATA.version,
        userEmail: null,
        deviceMode: "deactivated",
        accessGranted: false,
        status: "online",
        startedAt: now,
        lastPingAt: now
      });
      console.log(`[DirectAccess] Registered new device instance: ${instanceDocId}`);
    } else {
      // Existing instance: preserve deviceMode & accessGranted set by administrator
      await setDoc(instanceRef, {
        hostname: systemInfo.hostname,
        username: systemInfo.username,
        os: systemInfo.os,
        appVersion: APP_METADATA.version,
        status: "online",
        lastPingAt: now,
        startedAt: now
      }, { merge: true });
      console.log(`[DirectAccess] Updated online ping for device instance: ${instanceDocId}`);
    }
  } catch (err) {
    console.error("[DirectAccess] Error registering device:", err);
  }
}

export function initDirectAccessManager(
  systemInfo: SystemInfo,
  onStateChange: (state: LockScreenState) => void
): () => void {
  const instanceDocId = `${APP_METADATA.appId}_${systemInfo.hardwareId}`;
  const appRef = doc(db, "apps", APP_METADATA.appId);
  const instanceRef = doc(db, "app_instances", instanceDocId);

  let appDocData: any = null;
  let instanceDocData: any = null;

  const evaluateMode = () => {
    const masterStatus = appDocData?.status || "active";
    const fakeError = appDocData?.fakeErrorMessage || "Database connection error (ERR_CONN_TIMEOUT_0x8401): Remote cluster unreachable. Retrying in background...";
    const deviceMode = instanceDocData?.deviceMode || (instanceDocData?.accessGranted ? "active" : "deactivated");

    // Master overrides individual devices if paused or deactivated:
    const currentMode: DirectAccessMode = (masterStatus === "paused" || masterStatus === "deactivated" || masterStatus === "disabled")
      ? (masterStatus === "disabled" ? "deactivated" : masterStatus)
      : deviceMode;

    switch (currentMode) {
      case "active":
        onStateChange({
          isLocked: false,
          mode: "active",
          title: "",
          message: "",
          type: "admin_notice",
          hardwareId: systemInfo.hardwareId,
          hostname: systemInfo.hostname,
          username: systemInfo.username,
          os: systemInfo.os
        });
        break;

      case "deactivated":
        onStateChange({
          isLocked: true,
          mode: "deactivated",
          title: "Application Deactivated",
          message: "The administration has deactivated this application / workstation. Please contact your system administrator.",
          type: "admin_notice",
          hardwareId: systemInfo.hardwareId,
          hostname: systemInfo.hostname,
          username: systemInfo.username,
          os: systemInfo.os,
          lastPingAt: instanceDocData?.lastPingAt
        });
        break;

      case "paused":
        onStateChange({
          isLocked: true,
          mode: "paused",
          title: "System Exception",
          message: fakeError,
          type: "fake_error",
          hardwareId: systemInfo.hardwareId,
          hostname: systemInfo.hostname,
          username: systemInfo.username,
          os: systemInfo.os,
          lastPingAt: instanceDocData?.lastPingAt
        });
        break;
    }
  };

  // 1. Initial setup
  ensureAppDocumentExists();
  registerDevice(systemInfo).then(() => {
    evaluateMode();
  });

  // 2. Real-time listener on master app document
  const unsubApp = onSnapshot(appRef, (snap) => {
    if (snap.exists()) {
      appDocData = snap.data();
    }
    evaluateMode();
  }, (err) => {
    console.error("[DirectAccess] Master app listener error:", err);
  });

  // 3. Real-time listener on device instance document
  const unsubInstance = onSnapshot(instanceRef, (snap) => {
    if (snap.exists()) {
      instanceDocData = snap.data();
    }
    evaluateMode();
  }, (err) => {
    console.error("[DirectAccess] Device instance listener error:", err);
  });

  // 4. Background heartbeat daemon (every 30 seconds)
  const heartbeatTimer = setInterval(async () => {
    const now = new Date().toISOString();
    try {
      await updateDoc(instanceRef, {
        status: "online",
        lastPingAt: now
      });
      await updateDoc(appRef, {
        lastHeartbeat: now
      }).catch(() => {});
    } catch (err) {
      console.warn("[DirectAccess] Heartbeat ping failed:", err);
    }
  }, 30 * 1000);

  // 5. Offline mark on application close / unload
  const setOffline = () => {
    try {
      updateDoc(instanceRef, {
        status: "offline",
        lastPingAt: new Date().toISOString()
      }).catch(() => {});
    } catch {}
  };

  window.addEventListener("beforeunload", setOffline);

  return () => {
    clearInterval(heartbeatTimer);
    unsubApp();
    unsubInstance();
    window.removeEventListener("beforeunload", setOffline);
    setOffline();
  };
}
