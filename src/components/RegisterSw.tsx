"use client";

import { useEffect } from "react";

const RELOAD_KEY = "ia.sw.reloaded.v3";

export function RegisterSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onControllerChange = () => {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, "1");
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;
    const checkUpdate = () => {
      void registration?.update();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkUpdate();
    };

    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        void reg.update();
        document.addEventListener("visibilitychange", onVisibility);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
