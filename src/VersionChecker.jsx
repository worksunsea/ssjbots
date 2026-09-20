import { useEffect, useState, useRef } from "react";
import { BUILD_VERSION } from "./buildVersion.generated.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // poll every 5 min
const FORCE_RELOAD_AFTER_MS = 4 * 60 * 60 * 1000; // auto-reload 4h after a new version is first seen

export default function VersionChecker() {
  const [newVersion, setNewVersion] = useState(false);
  const firstSeenAt = useRef(null);

  useEffect(() => {
    if (BUILD_VERSION === "dev") return; // skip in local dev — no real deploys to detect
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        if (data.version && data.version !== BUILD_VERSION) {
          if (!firstSeenAt.current) firstSeenAt.current = Date.now();
          setNewVersion(true);
        }
      } catch {
        // network hiccup — ignore, try again next interval
      }
    };
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!newVersion) return;
    const remaining = FORCE_RELOAD_AFTER_MS - (Date.now() - (firstSeenAt.current || Date.now()));
    const timer = setTimeout(() => window.location.reload(), Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [newVersion]);

  if (!newVersion) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "#1e40af", color: "#fff", fontSize: 13, fontWeight: 500,
      padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
    }}>
      <span>A new version of this app is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#fff", color: "#1e40af", border: "none", borderRadius: 6,
          padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        Refresh now
      </button>
    </div>
  );
}
