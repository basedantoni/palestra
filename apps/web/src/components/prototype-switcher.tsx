// PROTOTYPE: floating variant switcher for throwaway UI prototypes. Not production UI.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export function PrototypeSwitcher<K extends string>({
  variants,
  current,
  onChange,
}: {
  variants: ReadonlyArray<{ key: K; name: string }>;
  current: K;
  onChange: (key: K) => void;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const step = (by: number) => onChange(variants[(index + by + variants.length) % variants.length]!.key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[index]!;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-600 px-2 py-1 text-sm text-white shadow-lg ring-2 ring-white">
      <button type="button" aria-label="Previous variant" className="rounded-full p-1 hover:bg-white/20" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </button>
      <span className="font-mono">
        {v.key} ({v.name}) · {index + 1}/{variants.length}
      </span>
      <button type="button" aria-label="Next variant" className="rounded-full p-1 hover:bg-white/20" onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
