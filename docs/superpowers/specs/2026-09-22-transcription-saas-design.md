# SaaS de Transcricao Local Design

## Intent

Build a local-only Next.js transcription dashboard for audio and video files using AssemblyAI. The user should be able to upload a media file, start a transcription, watch progress in the browser, and copy or download the result in several useful formats.

## Constraints

- Next.js App Router, React, TypeScript, Tailwind CSS.
- AssemblyAI API key lives only in `.env.local` as `ASSEMBLYAI_API_KEY`.
- No authentication, database, billing, deployment, or automated test suite.
- Session state is stored in `localStorage`.
- The frontend never receives the API key.

## Architecture

The app has a single page at `/`. Client state tracks uploads, selected transcription, polling, and display mode. API routes proxy AssemblyAI calls server-side: upload/create transcript, poll status, fetch paragraphs, and fetch SRT.

The frontend stores completed transcript data and lightweight metadata in `localStorage`. Paragraphs and SRT are fetched on demand and cached in the current session item. JSON export uses the completed transcript payload from `/api/transcrever/status`.

## UI

The layout is a dark two-column workspace. The left column contains upload controls and a session list. The right column contains the selected transcript header, mode switcher, rendered transcript, and export actions.

Supported modes:

- Continuous text.
- Paragraphs from AssemblyAI `/paragraphs`.
- Speaker utterances if available.
- Timestamped utterances/words.

## API Routes

- `POST /api/transcrever`: accepts multipart file, uploads bytes to AssemblyAI, creates transcript with language detection, speaker labels, auto chapters, punctuation, and formatted text.
- `GET /api/transcrever/status?id=...`: returns queued/processing status or completed transcript data.
- `GET /api/transcrever/paragraphs?id=...`: returns AssemblyAI paragraph payload.
- `GET /api/transcrever/srt?id=...`: returns SRT text.

## Error Handling

Routes return JSON errors with appropriate status codes. The UI displays upload and polling errors inline and keeps existing session items intact. Large files over 200MB show a warning before upload.

## Verification

Because the product request excludes automated tests, verification uses TypeScript, linting, production build, and a local smoke check. Network calls to AssemblyAI are isolated behind server routes so they can be manually exercised with a real media file.
