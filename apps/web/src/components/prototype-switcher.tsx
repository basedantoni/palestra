// PROTOTYPE: floating variant switcher for throwaway UI prototypes. Not production UI.
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const navigate = useNavigate();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length]!;
    void navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, variant: next.key }), replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;
  const v = variants[index]!;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-2 py-1.5 text-sm text-white shadow-lg">
      <button type="button" onClick={() => go(-1)} className="rounded-full px-2 hover:bg-white/20" aria-label="Previous variant">
        ←
      </button>
      <span className="font-mono">
        {v.key} ({v.name})
      </span>
      <button type="button" onClick={() => go(1)} className="rounded-full px-2 hover:bg-white/20" aria-label="Next variant">
        →
      </button>
    </div>
  );
}
