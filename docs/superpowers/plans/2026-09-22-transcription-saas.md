# Transcription SaaS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js transcription dashboard backed by AssemblyAI.

**Architecture:** The browser owns session state, rendering, polling, and downloads. Next.js route handlers own all AssemblyAI communication using `ASSEMBLYAI_API_KEY` from `.env.local`.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, lucide-react, AssemblyAI REST API.

**Spec:** `docs/superpowers/specs/2026-09-22-transcription-saas-design.md`

## Global Constraints

- Do not expose `ASSEMBLYAI_API_KEY` to client code.
- Do not add authentication, database, billing, deployment, CI/CD, or automated tests.
- Store session history in `localStorage`.
- Accept `.mp4`, `.mov`, `.webm`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`.
- Warn for files over 200MB before uploading.

## Review Focus

- Missing API key should produce a helpful server error instead of crashing.
- Failed AssemblyAI upload or transcript calls should preserve UI state and show an error.
- Reloaded completed transcripts should render from `localStorage`.
- Empty mode data, such as no utterances or paragraphs, should show a useful fallback.
- Download actions should produce valid `.txt`, `.srt`, and `.json` content.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: runnable Next.js app with Tailwind configured.

- [ ] Create the scaffold files.
- [ ] Install dependencies.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.

### Task 2: AssemblyAI API Layer

**Files:**
- Create: `src/lib/assemblyai.ts`, `src/lib/types.ts`
- Create: `src/app/api/transcrever/route.ts`
- Create: `src/app/api/transcrever/status/route.ts`
- Create: `src/app/api/transcrever/paragraphs/route.ts`
- Create: `src/app/api/transcrever/srt/route.ts`

**Interfaces:**
- Produces: `POST /api/transcrever`, `GET /api/transcrever/status`, `GET /api/transcrever/paragraphs`, `GET /api/transcrever/srt`.

- [ ] Implement typed AssemblyAI helper functions.
- [ ] Implement all API routes with JSON errors.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.

### Task 3: Dashboard UI

**Files:**
- Create: `src/components/transcription-dashboard.tsx`
- Create: `src/app/page.tsx`

**Interfaces:**
- Consumes: API routes from Task 2.
- Produces: upload, polling, session list, render modes, copy and download actions.

- [ ] Implement upload and session state.
- [ ] Implement polling and `localStorage` persistence.
- [ ] Implement display modes and export actions.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.

### Task 4: Final Polish

**Files:**
- Modify: UI, CSS, docs as needed.

**Interfaces:**
- Consumes: full app.
- Produces: verified local app ready to run.

- [ ] Check responsive layout and loading/error/empty states.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start the dev server and provide the local URL.
