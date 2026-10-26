"use client";
import { useState } from "react";

/**
 * Copies a short prompt for the user's own Claude, which has the Warm Paths
 * connector: Claude reads message_context and writes the message on the
 * user's subscription. Nothing is sent from here.
 */
export function WriteInClaude({ prompt, label = "Write in Claude", copied = "Copied: paste it into Claude", className = "btn small" }: { prompt: string; label?: string; copied?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(prompt);
      setState("copied");
    } catch {
      // Older browsers or a page without clipboard access: select and copy.
      const t = document.createElement("textarea");
      t.value = prompt;
      document.body.appendChild(t);
      t.select();
      setState(document.execCommand("copy") ? "copied" : "failed");
      t.remove();
    }
    setTimeout(() => setState("idle"), 2400);
  }
  return (
    <button type="button" className={className} onClick={copy} title={`Copies a prompt for your own Claude, which writes the message. Nothing is sent. The prompt: ${prompt}`}>
      {state === "copied" ? copied : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
