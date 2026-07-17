"use client";

import { usePortal } from "@/lib/store";

export function Toast() {
  const toast = usePortal((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  );
}
