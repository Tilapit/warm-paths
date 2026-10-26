"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Network" },
  { href: "/people", label: "People" },
  { href: "/radar", label: "Signal radar" },
  // Themes stays reachable at /themes and through MCP (people_for_theme); not in the menu.
  { href: "/settings", label: "Settings" },
];

export function Nav({ radar }: { radar?: number }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((i) => {
        const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}>
            {i.label}
            {i.href === "/radar" && radar ? <span className="count">{radar}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#e8eaed" />
      <circle cx="9" cy="16" r="2.6" fill="#0b0d10" />
      <circle cx="16" cy="9" r="2.6" fill="#0b0d10" />
      <circle cx="16" cy="23" r="2.6" fill="#0b0d10" />
      <circle cx="23.5" cy="16" r="3.2" fill="#3d7bff" />
      <path d="M9 16 L16 9 L23.5 16 L16 23 Z" stroke="#0b0d10" strokeWidth="1.4" fill="none" />
    </svg>
  );
}
