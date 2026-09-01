---
name: 4Form AI migration patterns
description: Lessons from porting the app (then AthleteAI, package "lense") from Next.js to Vite + React in the pnpm workspace
---

## Key patterns

- `next/link` → `import { Link } from "wouter"`
- `usePathname()` → `const [location] = useLocation()` from wouter
- `useRouter().push(path)` → `const [, navigate] = useLocation(); navigate(path)`
- `useRouter().back()` → `history.back()`
- Remove all `"use client"` directives — not needed in Vite
- `@mediapipe/pose` loaded from CDN in component, no package needed

**Why:** Wouter is already in the scaffold; it's the idiomatic router for this stack.

## CSS

The original app uses raw CSS custom properties (--bg, --surface, --accent, --energy, etc.), not Tailwind theme tokens. Place the full original globals.css content in `artifacts/<slug>/src/index.css`, prepending `@import "tailwindcss";`. Do NOT use the scaffold's default index.css (it has placeholder `red` values).

**Why:** The app uses inline styles referencing CSS vars everywhere, so the vars must be present or the whole UI breaks.

## Missing deps pattern

The copy script tries to install `next` (to resolve peer deps) which causes timeouts. Add only the real missing deps manually after the script times out:
- `pnpm add zustand --save-dev` inside the artifact dir
