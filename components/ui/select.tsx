"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name for the trigger. */
  label: string;
  className?: string;
}

/**
 * Styled replacement for a native <select>. The native control's popup is
 * drawn by the OS and can't be themed; this renders its own menu in the
 * app's card style. Supports click-outside, Escape, arrow keys, Enter.
 */
export function Select({ value, options, onChange, label, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((a) => (e.key === "ArrowDown" ? Math.min(options.length - 1, a + 1) : Math.max(0, a - 1)));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) choose(active);
      else setOpen(true);
    }
  };

  return (
    <div ref={wrap} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((v) => !v);
        }}
        onKeyDown={onKey}
        className="h-9 inline-flex items-center gap-2 rounded-md border border-border bg-card pl-3 pr-2.5 text-xs text-foreground cursor-pointer hover:bg-card/80 focus:outline-none focus:ring-1 focus:ring-primary whitespace-nowrap"
      >
        <span>{current?.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-activedescendant={`${listId}-${active}`}
          className="absolute left-0 top-10 z-50 min-w-full w-max rounded-lg border border-border bg-background shadow-xl p-1"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer whitespace-nowrap",
                  i === active ? "bg-muted text-foreground" : "text-muted-foreground",
                  selected && "text-foreground"
                )}
              >
                <Check className={cn("h-3.5 w-3.5", selected ? "opacity-100" : "opacity-0")} />
                {o.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
