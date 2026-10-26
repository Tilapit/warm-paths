"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExcludeButton({ businessId, name, excluded }: { businessId: string; name: string; excluded: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/exclude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId, name, exclude: !excluded }) });
        setBusy(false);
        router.refresh();
      }}
    >
      {excluded ? "Back to the list" : "Not a target company"}
    </button>
  );
}
