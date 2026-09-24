"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  CloudUpload,
  Download,
  FileJson,
  FileText,
  Globe2,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Trash2,
  Timer,
  Users
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SCENES_STORAGE_KEY,
  TARGET_MAX_SECONDS,
  TARGET_MIN_SECONDS,
  addEmptyScene,
  buildSceneSetFromTranscript,
  calculateTotalDuration,
  copyAllPromptsText,
  deleteScene,
  formatSceneDuration,
  generateVeoPrompt,
  updateSceneText,
  type Scene,
  type SceneSet
} from "@/lib/scenes";
import type { Paragraph, TranscriptData } from "@/lib/types";

type SessionStatus = "queued" | "uploading" | "processing" | "completed" | "error";
type ViewMode = "text" | "paragraphs" | "speakers" | "timestamps";
type MainTab = "transcriber" | "scenes";

type SessionItem = {
  id: string;
  transcriptId?: string;
  fileName: string;
  fileSize: number;
  status: SessionStatus;
  createdAt: number;
  data?: TranscriptData;
  paragraphs?: Paragraph[];
  srt?: string;
  error?: string;
};

const STORAGE_KEY = "transcription-sessions-v1";
const ACCEPTED_EXTENSIONS = ".mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg,.flac";
const LARGE_FILE_BYTES = 200 * 1024 * 1024;
const MAX_CONCURRENT_TRANSCRIPTIONS = 3;

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "text", label: "Texto corrido" },
  { id: "paragraphs", label: "Parágrafos" },
  { id: "speakers", label: "Speakers" },
  { id: "timestamps", label: "Timestamps" }
];

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds?: number) {
  if (!seconds) return "--:--";

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatTimestamp(milliseconds?: number) {
  if (milliseconds === undefined) return "00:00:00";

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getWordCount(text?: string) {
  if (!text?.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function getSpeakerCount(data?: TranscriptData) {
  const speakers = new Set(
    data?.utterances?.map((utterance) => utterance.speaker).filter(Boolean)
  );

  return speakers.size;
}

function getPreview(text?: string) {
  if (!text?.trim()) return "";

  const words = text.trim().split(/\s+/).slice(0, 30);
  return `${words.join(" ")}${words.length >= 30 ? "..." : ""}`;
}

function safeFileBaseName(name: string) {
  return name.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getRenderedText(item: SessionItem | undefined, mode: ViewMode) {
  if (!item?.data) return "";

  if (mode === "paragraphs") {
    return item.paragraphs?.map((paragraph) => paragraph.text).join("\n\n") || item.data.text || "";
  }

  if (mode === "speakers") {
    return (
      item.data.utterances
        ?.map((utterance) => `Speaker ${utterance.speaker}: ${utterance.text}`)
        .join("\n\n") ||
      item.data.text ||
      ""
    );
  }

  if (mode === "timestamps") {
    if (item.data.utterances?.length) {
      return item.data.utterances
        .map((utterance) => `[${formatTimestamp(utterance.start)}] ${utterance.text}`)
        .join("\n");
    }

    return (
      item.data.words?.map((word) => `[${formatTimestamp(word.start)}] ${word.text}`).join(" ") ||
      item.data.text ||
      ""
    );
  }

  return item.data.text || "";
}

function getStatusText(status: SessionStatus) {
  if (status === "queued") return "Na fila";
  if (status === "uploading") return "Enviando...";
  if (status === "processing") return "Transcrevendo...";
  if (status === "completed") return "Pronto";
  return "Erro";
}

function getStatusChipClass(status: SessionStatus) {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold";

  if (status === "queued") return `${base} bg-white/8 text-slate-300`;
  if (status === "uploading") return `${base} bg-sky-300/12 text-sky-200`;
  if (status === "processing") return `${base} bg-amber-300/12 text-amber-200`;
  if (status === "completed") return `${base} bg-teal-300/12 text-teal-200`;
  return `${base} bg-red-400/12 text-red-200`;
}

export function TranscriptionDashboard() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sceneSets, setSceneSets] = useState<SceneSet[]>([]);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [hasLoadedScenes, setHasLoadedScenes] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [activeSceneSetId, setActiveSceneSetId] = useState<string>();
  const [activeTab, setActiveTab] = useState<MainTab>("transcriber");
  const [mode, setMode] = useState<ViewMode>("text");
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState<string>();
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [sceneCopyState, setSceneCopyState] = useState<string>();
  const [selectedFilesCount, setSelectedFilesCount] = useState(0);
  const [toasts, setToasts] = useState<Array<{ id: string; text: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(new Map<string, File>());
  const startingIdsRef = useRef(new Set<string>());
  const selectedIdRef = useRef<string | undefined>(undefined);

  const selectedItem = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [selectedId, sessions]
  );

  const renderedText = useMemo(
    () => getRenderedText(selectedItem, mode),
    [mode, selectedItem]
  );

  const activeSceneSet = useMemo(
    () => sceneSets.find((set) => set.id === activeSceneSetId) ?? sceneSets[0],
    [activeSceneSetId, sceneSets]
  );

  const completedCount = useMemo(
    () => sessions.filter((session) => session.status === "completed").length,
    [sessions]
  );

  const activeCount = useMemo(
    () => sessions.filter((session) => ["uploading", "processing"].includes(session.status)).length,
    [sessions]
  );

  const updateSession = useCallback((id: string, patch: Partial<SessionItem>) => {
    setSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, ...patch } : session))
    );
  }, []);

  const addToast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const startQueuedSession = useCallback(async (session: SessionItem) => {
    const file = filesRef.current.get(session.id);

    if (!file) {
      updateSession(session.id, {
        status: "error",
        error: "Arquivo original não está mais disponível. Selecione novamente para tentar."
      });
      return;
    }

    startingIdsRef.current.add(session.id);
    updateSession(session.id, {
      status: "uploading",
      error: undefined,
      transcriptId: undefined
    });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/transcrever", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Falha ao iniciar transcrição.");
      }

      updateSession(session.id, {
        transcriptId: payload.transcript_id,
        status: "processing"
      });
    } catch (error) {
      updateSession(session.id, {
        status: "error",
        error: error instanceof Error ? error.message : "Erro inesperado."
      });
    } finally {
      startingIdsRef.current.delete(session.id);
    }
  }, [updateSession]);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        setHasLoadedSessions(true);
        return;
      }

      try {
        const parsed = JSON.parse(stored) as SessionItem[];
        setSessions(
          parsed.map((session) =>
            ["queued", "uploading"].includes(session.status)
              ? {
                  ...session,
                  status: "error",
                  error: "Arquivo original não está mais disponível. Selecione novamente para tentar."
                }
              : session
          )
        );
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHasLoadedSessions(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hasLoadedSessions) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [hasLoadedSessions, sessions]);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(SCENES_STORAGE_KEY);

      if (!stored) {
        setHasLoadedScenes(true);
        return;
      }

      try {
        const parsed = JSON.parse(stored) as SceneSet[];
        setSceneSets(parsed);
        setActiveSceneSetId(parsed[0]?.id);
      } catch {
        window.localStorage.removeItem(SCENES_STORAGE_KEY);
      } finally {
        setHasLoadedScenes(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hasLoadedScenes) return;
    localStorage.setItem(SCENES_STORAGE_KEY, JSON.stringify(sceneSets));
  }, [hasLoadedScenes, sceneSets]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!hasLoadedSessions) return;

    const openSlots = Math.max(0, MAX_CONCURRENT_TRANSCRIPTIONS - activeCount);
    if (openSlots === 0) return;

    const nextSessions = sessions
      .filter(
        (session) =>
          session.status === "queued" &&
          filesRef.current.has(session.id) &&
          !startingIdsRef.current.has(session.id)
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, openSlots);

    nextSessions.forEach((session) => {
      void startQueuedSession(session);
    });
  }, [activeCount, hasLoadedSessions, sessions, startQueuedSession]);

  useEffect(() => {
    const active = sessions.filter(
      (session) => session.transcriptId && session.status === "processing"
    );

    if (!active.length) return;

    const poll = async () => {
      await Promise.all(
        active.map(async (session) => {
          try {
            const response = await fetch(`/api/transcrever/status?id=${session.transcriptId}`);
            const payload = await response.json();

            if (!response.ok) {
              throw new Error(payload.error || "Falha ao consultar status.");
            }

            if (payload.status === "completed") {
              updateSession(session.id, {
                status: "completed",
                data: payload.data,
                error: undefined
              });
              if (selectedIdRef.current === session.id) {
                setSelectedId(session.id);
              } else {
                addToast(`${session.fileName} ficou pronta.`);
              }
            } else {
              updateSession(session.id, { status: "processing" });
            }
          } catch (error) {
            updateSession(session.id, {
              status: "error",
              error: error instanceof Error ? error.message : "Erro inesperado."
            });
          }
        })
      );
    };

    void poll();
    const interval = window.setInterval(poll, 3000);
    return () => window.clearInterval(interval);
  }, [addToast, sessions, updateSession]);

  useEffect(() => {
    if (mode !== "paragraphs" || !selectedItem?.transcriptId || selectedItem.paragraphs) {
      return;
    }

    const loadParagraphs = async () => {
      try {
        const response = await fetch(`/api/transcrever/paragraphs?id=${selectedItem.transcriptId}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Falha ao carregar parágrafos.");
        }

        updateSession(selectedItem.id, { paragraphs: payload.paragraphs || [] });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Erro ao carregar parágrafos.");
      }
    };

    void loadParagraphs();
  }, [mode, selectedItem, updateSession]);

  useEffect(() => {
    if (copyState !== "copied") return;

    const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const handleFiles = (files: FileList | null) => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;

    const createdAt = Date.now();
    const nextSessions = selectedFiles.map((file, index) => {
      const id = crypto.randomUUID();
      filesRef.current.set(id, file);

      return {
        id,
        fileName: file.name,
        fileSize: file.size,
        status: "queued" as const,
        createdAt: createdAt + index
      };
    });

    setSelectedFilesCount(selectedFiles.length);
    setMessage(
      selectedFiles.some((file) => file.size > LARGE_FILE_BYTES)
        ? `${selectedFiles.length} ${selectedFiles.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}. Há arquivo acima de 200MB; o envio pode demorar bastante.`
        : `${selectedFiles.length} ${selectedFiles.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}.`
    );
    setSessions((current) => [...nextSessions, ...current]);
    setSelectedId(nextSessions[0]?.id);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const retrySession = (session: SessionItem) => {
    if (!filesRef.current.has(session.id)) {
      setMessage("Arquivo original não está mais disponível. Selecione o arquivo novamente.");
      return;
    }

    updateSession(session.id, {
      status: "queued",
      error: undefined,
      transcriptId: undefined,
      data: undefined,
      paragraphs: undefined,
      srt: undefined
    });
  };

  const removeSession = (session: SessionItem) => {
    filesRef.current.delete(session.id);
    startingIdsRef.current.delete(session.id);

    setSessions((current) => {
      const nextSessions = current.filter((item) => item.id !== session.id);

      setSelectedId((currentSelectedId) => {
        if (currentSelectedId && currentSelectedId !== session.id) return currentSelectedId;
        return nextSessions[0]?.id;
      });

      return nextSessions;
    });

    if (session.transcriptId) {
      setSceneSets((current) => {
        const nextSceneSets = current.filter((sceneSet) => sceneSet.sourceTranscriptId !== session.transcriptId);

        setActiveSceneSetId((currentSceneSetId) => {
          if (currentSceneSetId && nextSceneSets.some((sceneSet) => sceneSet.id === currentSceneSetId)) {
            return currentSceneSetId;
          }

          return nextSceneSets[0]?.id;
        });

        return nextSceneSets;
      });
    }
  };

  const openScenesForSession = (session: SessionItem) => {
    if (!session.data?.text || !session.transcriptId) return;

    const existing = sceneSets.find((set) => set.sourceTranscriptId === session.transcriptId);

    if (existing) {
      setActiveSceneSetId(existing.id);
      setActiveTab("scenes");
      return;
    }

    const nextSet = buildSceneSetFromTranscript({
      sourceTranscriptId: session.transcriptId,
      sourceName: session.fileName,
      sourceText: session.data.text
    });

    setSceneSets((current) => [nextSet, ...current]);
    setActiveSceneSetId(nextSet.id);
    setActiveTab("scenes");
  };

  const updateActiveSceneSet = (updater: (sceneSet: SceneSet) => SceneSet) => {
    if (!activeSceneSet) return;

    setSceneSets((current) =>
      current.map((sceneSet) =>
        sceneSet.id === activeSceneSet.id
          ? {
              ...updater(sceneSet),
              updatedAt: Date.now()
            }
          : sceneSet
      )
    );
  };

  const editScene = (sceneId: string, text: string) => {
    updateActiveSceneSet((sceneSet) => ({
      ...sceneSet,
      scenes: updateSceneText(sceneSet.scenes, sceneId, text),
      hasManualEdits: true
    }));
  };

  const addScene = () => {
    updateActiveSceneSet((sceneSet) => ({
      ...sceneSet,
      scenes: addEmptyScene(sceneSet.scenes),
      hasManualEdits: true
    }));
  };

  const removeScene = (sceneId: string) => {
    updateActiveSceneSet((sceneSet) => ({
      ...sceneSet,
      scenes: deleteScene(sceneSet.scenes, sceneId),
      hasManualEdits: true
    }));
  };

  const regenerateScenes = () => {
    if (!activeSceneSet) return;

    if (
      activeSceneSet.hasManualEdits &&
      !window.confirm("Refazer a divisão vai sobrescrever alterações manuais. Deseja continuar?")
    ) {
      return;
    }

    const regenerated = buildSceneSetFromTranscript({
      sourceTranscriptId: activeSceneSet.sourceTranscriptId,
      sourceName: activeSceneSet.sourceName,
      sourceText: activeSceneSet.sourceText,
      existingId: activeSceneSet.id
    });

    setSceneSets((current) =>
      current.map((sceneSet) =>
        sceneSet.id === activeSceneSet.id
          ? {
              ...regenerated,
              createdAt: sceneSet.createdAt
            }
          : sceneSet
      )
    );
  };

  const copySceneText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setSceneCopyState(label);
    window.setTimeout(() => setSceneCopyState(undefined), 1600);
  };

  const copyText = async () => {
    if (!renderedText) return;

    await navigator.clipboard.writeText(renderedText);
    setCopyState("copied");
    setMessage("Texto copiado.");
  };

  const downloadTxt = () => {
    if (!selectedItem || !renderedText) return;
    downloadText(`${safeFileBaseName(selectedItem.fileName)}.txt`, renderedText);
  };

  const downloadJson = () => {
    if (!selectedItem?.data) return;
    downloadText(
      `${safeFileBaseName(selectedItem.fileName)}.json`,
      JSON.stringify(selectedItem.data, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const downloadSrt = async () => {
    if (!selectedItem?.transcriptId) return;

    try {
      let srt = selectedItem.srt;

      if (!srt) {
        const response = await fetch(`/api/transcrever/srt?id=${selectedItem.transcriptId}`);
        srt = await response.text();

        if (!response.ok) {
          throw new Error(srt || "Falha ao baixar SRT.");
        }

        updateSession(selectedItem.id, { srt });
      }

      downloadText(`${safeFileBaseName(selectedItem.fileName)}.srt`, srt);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao baixar SRT.");
    }
  };

  return (
    <main className="min-h-screen bg-[#070a0e] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-5 py-5 lg:px-8">
        <div className="fixed right-5 top-5 z-50 flex w-[min(360px,calc(100vw-40px))] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              className="rounded-xl border border-teal-300/20 bg-slate-950/95 px-4 py-3 text-sm text-teal-50 shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
              key={toast.id}
            >
              {toast.text}
            </div>
          ))}
        </div>

        <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 shadow-[0_18px_70px_rgba(0,0,0,0.24)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline">
            <h1 className="text-3xl font-semibold tracking-normal text-white">
              Transcritor
            </h1>
            <p className="text-sm text-slate-400 sm:border-l sm:border-white/10 sm:pl-4">
              Transcreva vídeos e áudios em texto
            </p>
          </div>
          <nav className="flex w-fit rounded-full bg-black/20 p-1 ring-1 ring-white/10">
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold transition duration-200 ${
                activeTab === "transcriber"
                  ? "bg-teal-300 text-slate-950"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              }`}
              onClick={() => setActiveTab("transcriber")}
              type="button"
            >
              Transcritor
            </button>
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold transition duration-200 ${
                activeTab === "scenes"
                  ? "bg-teal-300 text-slate-950"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              }`}
              onClick={() => setActiveTab("scenes")}
              type="button"
            >
              Cenas
            </button>
          </nav>
        </header>

        {activeTab === "transcriber" ? (
        <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-4">
            <label
              className={`group flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center shadow-[0_18px_70px_rgba(0,0,0,0.18)] transition duration-200 ease-out ${
                isDragging
                  ? "border-teal-300 bg-teal-300/12 shadow-[0_20px_90px_rgba(45,212,191,0.12)]"
                  : "border-white/15 bg-white/[0.045] hover:border-teal-300/50 hover:bg-white/[0.065]"
              } cursor-pointer`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleFiles(event.dataTransfer.files);
              }}
              htmlFor="transcription-file-upload"
            >
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-300/12 text-teal-200 transition duration-200 ease-out group-hover:scale-105">
                <CloudUpload className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-semibold text-white">
                Arraste arquivos aqui
              </h2>
              <p className="mt-2 text-sm text-slate-400">ou clique para escolher</p>
              {selectedFilesCount > 0 ? (
                <p className="mt-3 rounded-full bg-teal-300/12 px-3 py-1 text-xs font-semibold text-teal-100">
                  {selectedFilesCount} {selectedFilesCount === 1 ? "arquivo selecionado" : "arquivos selecionados"}
                </p>
              ) : null}
              <p className="mt-4 max-w-[260px] text-xs leading-5 text-slate-500">
                MP4, MOV, WEBM, MP3, WAV, M4A, OGG ou FLAC
              </p>

              <input
                id="transcription-file-upload"
                ref={fileInputRef}
                className="sr-only"
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                onChange={(event) => handleFiles(event.target.files)}
              />
            </label>

            {message ? (
              <div className="flex gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{message}</span>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_18px_70px_rgba(0,0,0,0.18)]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="font-semibold text-white">Histórico</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {completedCount} de {sessions.length} prontos
                  </p>
                </div>
                <span className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-slate-400">
                  {activeCount}/{MAX_CONCURRENT_TRANSCRIPTIONS} ativos
                </span>
              </div>
              <div className="max-h-[48vh] space-y-3 overflow-auto p-3 lg:max-h-none">
                {sessions.length ? (
                  sessions.map((session) => (
                    <article
                      className={`w-full cursor-pointer rounded-xl p-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.14)] outline-none transition duration-200 ease-out focus-visible:ring-2 focus-visible:ring-teal-200/70 ${
                        selectedItem?.id === session.id
                          ? "bg-teal-300/12 ring-1 ring-teal-300/45"
                          : "bg-black/20 ring-1 ring-white/10 hover:bg-white/[0.055] hover:ring-white/20"
                      } ${["uploading", "processing"].includes(session.status) ? "animate-pulse" : ""}`}
                      key={session.id}
                      onClick={() => setSelectedId(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(session.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start gap-3">
                        <StatusIcon status={session.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="truncate text-sm font-semibold text-white">
                              {session.fileName}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className={getStatusChipClass(session.status)}>
                                {getStatusText(session.status)}
                              </span>
                              <button
                                aria-label={`Remover ${session.fileName} do histórico`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-400/10 text-red-200 ring-1 ring-red-300/20 transition hover:bg-red-400/18 hover:text-red-100"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeSession(session);
                                }}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatBytes(session.fileSize)} · {formatDuration(session.data?.audio_duration)}
                          </div>
                        </div>
                      </div>
                      {session.data?.text ? (
                        <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-400">
                          {getPreview(session.data.text)}
                        </p>
                      ) : (
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          {session.status === "error"
                            ? "Não foi possível concluir esta transcrição."
                            : session.status === "queued"
                              ? "Aguardando um slot livre para iniciar."
                              : session.status === "uploading"
                                ? "Enviando o arquivo para iniciar a transcrição."
                                : "A prévia aparecerá quando o texto estiver pronto."}
                        </p>
                      )}
                      {session.status === "error" ? (
                        <button
                          className="mt-3 inline-flex rounded-full bg-red-400/12 px-3 py-1.5 text-xs font-semibold text-red-100 ring-1 ring-red-300/20 transition hover:bg-red-400/18"
                          onClick={(event) => {
                            event.stopPropagation();
                            retrySession(session);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.stopPropagation();
                            }
                          }}
                          type="button"
                        >
                          Tentar novamente
                        </button>
                      ) : null}
                      {session.status === "completed" && session.data?.text ? (
                        <button
                          className="mt-3 inline-flex rounded-full bg-teal-300/12 px-3 py-1.5 text-xs font-semibold text-teal-100 ring-1 ring-teal-300/20 transition hover:bg-teal-300/18"
                          onClick={(event) => {
                            event.stopPropagation();
                            openScenesForSession(session);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.stopPropagation();
                            }
                          }}
                          type="button"
                        >
                          Criar cenas
                        </button>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span className="rounded-full bg-white/8 px-2 py-1">
                          {(session.data?.language_code || "--").toUpperCase()}
                        </span>
                        <span className="rounded-full bg-white/8 px-2 py-1">
                          {getWordCount(session.data?.text)} palavras
                        </span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Nenhuma transcrição ainda.
                  </div>
                )}
              </div>
              <div className="border-t border-white/10 px-4 py-3 text-xs text-slate-500">
                {sessions.length} {sessions.length === 1 ? "transcrição" : "transcrições"} nesta sessão
              </div>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_22px_90px_rgba(0,0,0,0.22)]">
            {selectedItem ? (
              <div className="flex h-full min-h-[640px] flex-col">
                <div className="border-b border-white/10 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex items-center gap-2">
                        <ResultBadge status={selectedItem.status} />
                      </div>
                      <h2 className="truncate text-2xl font-semibold text-white">
                        {selectedItem.fileName}
                      </h2>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 xl:min-w-[500px]">
                      <Metric icon={<Globe2 />} label="Idioma" value={(selectedItem.data?.language_code || "--").toUpperCase()} />
                      <Metric icon={<Timer />} label="Duração" value={formatDuration(selectedItem.data?.audio_duration)} />
                      <Metric icon={<MessageSquareText />} label="Palavras" value={String(getWordCount(selectedItem.data?.text))} />
                      <Metric icon={<Users />} label="Speakers" value={String(getSpeakerCount(selectedItem.data) || "--")} />
                    </div>
                  </div>

                  {selectedItem.error ? (
                    <div className="mt-4 flex gap-2 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                      <span>{selectedItem.error}</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-4">
                  <div className="flex rounded-full bg-black/20 p-1 ring-1 ring-white/10">
                    {MODES.map((item) => (
                      <button
                        className={`rounded-full px-4 py-2 text-sm font-medium transition duration-200 ease-out ${
                          mode === item.id
                            ? "bg-teal-300 text-slate-950 shadow-[0_8px_22px_rgba(45,212,191,0.22)]"
                            : "text-slate-300 hover:bg-white/8 hover:text-white"
                        }`}
                        key={item.id}
                        onClick={() => setMode(item.id)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      disabled={!renderedText}
                      icon={copyState === "copied" ? <Check /> : <Clipboard />}
                      label={copyState === "copied" ? "Copiado ✓" : "Copiar texto"}
                      onClick={copyText}
                    />
                    <ActionButton disabled={!renderedText} icon={<FileText />} label="Baixar .txt" onClick={downloadTxt} />
                    <ActionButton disabled={selectedItem.status !== "completed"} icon={<Download />} label="Baixar .srt" onClick={downloadSrt} />
                    <ActionButton disabled={!selectedItem.data} icon={<FileJson />} label="Baixar .json" onClick={downloadJson} />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto scroll-smooth px-6 py-7 sm:px-8 lg:px-10">
                  {selectedItem.status === "completed" ? (
                    renderedText ? (
                      <TranscriptView item={selectedItem} mode={mode} text={renderedText} />
                    ) : (
                      <EmptyState text="Não há conteúdo disponível para este modo." />
                    )
                  ) : selectedItem.status === "error" ? (
                    <EmptyState text="Esta transcrição falhou. Tente enviar o arquivo novamente." />
                  ) : (
                    <div className="flex h-full min-h-[360px] items-center justify-center">
                      <div className="text-center">
                        <div className="mx-auto mb-5 h-14 w-14 animate-pulse rounded-2xl bg-teal-300/12 p-3 text-teal-300">
                          {selectedItem.status === "queued" ? (
                            <Timer className="h-8 w-8" />
                          ) : selectedItem.status === "uploading" ? (
                            <CloudUpload className="h-8 w-8" />
                          ) : (
                            <Loader2 className="h-8 w-8 animate-spin" />
                          )}
                        </div>
                        <div className="text-lg font-semibold text-white">
                          {getStatusText(selectedItem.status)}
                        </div>
                        <div className="mt-2 text-sm text-slate-400">
                          {selectedItem.status === "queued"
                            ? "Aguardando um dos 3 slots de transcrição liberar."
                            : selectedItem.status === "uploading"
                              ? "O arquivo está sendo enviado para iniciar o processamento."
                              : "O status atualiza automaticamente a cada 3 segundos."}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[640px] items-center justify-center p-6">
                <EmptyState text="Envie um arquivo para iniciar a primeira transcrição." />
              </div>
            )}
          </section>
        </section>
        ) : (
          <ScenesWorkspace
            activeSceneSet={activeSceneSet}
            copySceneText={copySceneText}
            copyState={sceneCopyState}
            regenerateScenes={regenerateScenes}
            sceneSets={sceneSets}
            selectSceneSet={setActiveSceneSetId}
            addScene={addScene}
            editScene={editScene}
            removeScene={removeScene}
          />
        )}
      </div>
    </main>
  );
}

function ScenesWorkspace({
  activeSceneSet,
  addScene,
  copySceneText,
  copyState,
  editScene,
  regenerateScenes,
  removeScene,
  sceneSets,
  selectSceneSet
}: {
  activeSceneSet?: SceneSet;
  addScene: () => void;
  copySceneText: (label: string, text: string) => Promise<void>;
  copyState?: string;
  editScene: (sceneId: string, text: string) => void;
  regenerateScenes: () => void;
  removeScene: (sceneId: string) => void;
  sceneSets: SceneSet[];
  selectSceneSet: (id: string) => void;
}) {
  const totalDuration = activeSceneSet ? calculateTotalDuration(activeSceneSet.scenes) : 0;

  return (
    <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_18px_70px_rgba(0,0,0,0.18)]">
        <div className="border-b border-white/10 px-4 py-4">
          <h2 className="text-lg font-semibold text-white">Cenas</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Narrativas já criadas a partir do histórico.
          </p>
        </div>
        <div className="max-h-[calc(100vh-210px)] space-y-3 overflow-auto p-3">
          {sceneSets.length ? (
            sceneSets.map((sceneSet) => (
              <button
                className={`w-full rounded-xl p-3 text-left transition duration-200 ${
                  activeSceneSet?.id === sceneSet.id
                    ? "bg-teal-300/12 ring-1 ring-teal-300/45"
                    : "bg-black/20 ring-1 ring-white/10 hover:bg-white/[0.055]"
                }`}
                key={sceneSet.id}
                onClick={() => selectSceneSet(sceneSet.id)}
                type="button"
              >
                <div className="truncate text-sm font-semibold text-white">
                  {sceneSet.sourceName}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  <span className="rounded-full bg-white/8 px-2 py-1">
                    {sceneSet.scenes.length} cenas
                  </span>
                  <span className="rounded-full bg-white/8 px-2 py-1">
                    ~{formatSceneDuration(calculateTotalDuration(sceneSet.scenes))}s
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {new Date(sceneSet.updatedAt).toLocaleDateString("pt-BR")}
                </div>
              </button>
            ))
          ) : (
            <div className="p-5 text-sm leading-6 text-slate-500">
              Clique em <span className="text-slate-300">Criar cenas</span> em uma transcrição pronta para começar.
            </div>
          )}
        </div>
      </aside>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_22px_90px_rgba(0,0,0,0.22)]">
        {activeSceneSet ? (
          <div className="flex h-full min-h-[640px] flex-col">
            <div className="border-b border-white/10 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold text-white">Cenas</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Divida suas transcrições em falas e gere prompts prontos para o Veo 3.
                  </p>
                  <div className="mt-4 truncate text-lg font-semibold text-white">
                    {activeSceneSet.sourceName}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-200"
                    onClick={() => copySceneText("todos", copyAllPromptsText(activeSceneSet.scenes))}
                    type="button"
                  >
                    <Clipboard className="h-4 w-4" />
                    {copyState === "todos" ? "Copiado" : "Copiar todos os prompts"}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 ring-1 ring-white/10 transition hover:bg-white/14"
                    onClick={regenerateScenes}
                    type="button"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refazer divisão
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 ring-1 ring-white/10 transition hover:bg-white/14"
                    onClick={addScene}
                    type="button"
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar cena
                  </button>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-sm text-slate-300">
                <span className="rounded-full bg-white/8 px-3 py-1.5">
                  {activeSceneSet.scenes.length} cenas
                </span>
                <span className="rounded-full bg-white/8 px-3 py-1.5">
                  ~{formatSceneDuration(totalDuration)}s
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-5">
              {activeSceneSet.scenes.map((scene) => (
                <SceneCard
                  copySceneText={copySceneText}
                  copyState={copyState}
                  editScene={editScene}
                  key={scene.id}
                  removeScene={removeScene}
                  scene={scene}
                  sceneCount={activeSceneSet.scenes.length}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[640px] items-center justify-center p-6">
            <EmptyState text="Nenhuma narrativa criada ainda. Use o botão Criar cenas em uma transcrição pronta." />
          </div>
        )}
      </section>
    </section>
  );
}

function SceneCard({
  copySceneText,
  copyState,
  editScene,
  removeScene,
  scene,
  sceneCount
}: {
  copySceneText: (label: string, text: string) => Promise<void>;
  copyState?: string;
  editScene: (sceneId: string, text: string) => void;
  removeScene: (sceneId: string) => void;
  scene: Scene;
  sceneCount: number;
}) {
  const prompt = generateVeoPrompt(scene.text);
  const isShort = scene.wordCount > 0 && scene.estimatedDuration < TARGET_MIN_SECONDS;
  const isLong = scene.estimatedDuration > TARGET_MAX_SECONDS;

  return (
    <article className="rounded-2xl bg-black/18 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.16)] ring-1 ring-white/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-teal-200">
            CENA {String(scene.order).padStart(2, "0")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-white/8 px-2 py-1">
              ~{formatSceneDuration(scene.estimatedDuration)}s
            </span>
            <span className="rounded-full bg-white/8 px-2 py-1">
              {scene.wordCount} palavras
            </span>
            {isLong ? (
              <span className="rounded-full bg-amber-300/12 px-2 py-1 font-semibold text-amber-100">
                Fala acima do tempo útil
              </span>
            ) : null}
            {isShort ? (
              <span className="rounded-full bg-amber-300/12 px-2 py-1 font-semibold text-amber-100">
                {sceneCount === 1 ? "Copy menor que 6 segundos" : "Fala abaixo de 6 segundos"}
              </span>
            ) : null}
          </div>
        </div>
        <button
          aria-label="Excluir cena"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-400/10 text-red-100 ring-1 ring-red-300/20 transition hover:bg-red-400/16"
          onClick={() => removeScene(scene.id)}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Fala
        </div>
        <textarea
          className="min-h-[110px] w-full resize-y rounded-xl border border-white/10 bg-slate-950/70 p-4 text-[15px] leading-7 text-slate-100 outline-none transition focus:border-teal-300/50"
          onChange={(event) => editScene(scene.id, event.target.value)}
          value={scene.text}
        />
        <button
          className="mt-2 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold text-slate-100 ring-1 ring-white/10 transition hover:bg-white/14"
          onClick={() => copySceneText(`fala-${scene.id}`, scene.text)}
          type="button"
        >
          {copyState === `fala-${scene.id}` ? "Fala copiada" : "Copiar fala"}
        </button>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Prompt Veo 3
        </div>
        <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-950/70 p-4 text-xs leading-6 text-slate-300">
          {prompt}
        </pre>
        <button
          className="mt-2 rounded-full bg-teal-300/12 px-3 py-1.5 text-xs font-semibold text-teal-100 ring-1 ring-teal-300/20 transition hover:bg-teal-300/18"
          onClick={() => copySceneText(`prompt-${scene.id}`, prompt)}
          type="button"
        >
          {copyState === `prompt-${scene.id}` ? "Prompt copiado" : "Copiar prompt"}
        </button>
      </div>
    </article>
  );
}

function StatusIcon({ status }: { status: SessionStatus }) {
  if (status === "queued") {
    return (
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/8 text-slate-300">
        <Timer className="h-4 w-4" />
      </span>
    );
  }

  if (status === "uploading") {
    return (
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-sky-300/15 text-sky-200">
        <CloudUpload className="h-4 w-4" />
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-teal-300/15 text-teal-200">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-red-400/15 text-red-200">
        <AlertCircle className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-amber-300/15 text-amber-200">
      <Loader2 className="h-4 w-4 animate-spin" />
    </span>
  );
}

function ResultBadge({ status }: { status: SessionStatus }) {
  const ready = status === "completed";
  const failed = status === "error";
  const queued = status === "queued";
  const uploading = status === "uploading";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        ready
          ? "bg-teal-300/15 text-teal-200"
          : failed
            ? "bg-red-400/15 text-red-200"
            : queued
              ? "bg-white/8 text-slate-300"
              : uploading
                ? "bg-sky-300/15 text-sky-200"
                : "bg-amber-300/15 text-amber-200"
      }`}
    >
      {ready ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : failed ? (
        <AlertCircle className="h-3.5 w-3.5" />
      ) : queued ? (
        <Timer className="h-3.5 w-3.5" />
      ) : uploading ? (
        <CloudUpload className="h-3.5 w-3.5" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      )}
      {getStatusText(status)}
    </span>
  );
}

function Metric({
  icon,
  label,
  value
}: {
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-full bg-white/[0.06] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.12)] ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        {React.cloneElement(icon, { className: "h-4 w-4 text-teal-200" })}
        <div className="min-w-0">
          <div className="text-[11px] leading-none text-slate-500">{label}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-100">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  disabled,
  icon,
  label,
  onClick
}: {
  disabled?: boolean;
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/8 text-slate-100 shadow-[0_10px_28px_rgba(0,0,0,0.12)] ring-1 ring-white/10 transition duration-200 ease-out hover:bg-white/14 hover:text-white disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-white/8"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {React.cloneElement(icon, { className: "h-4 w-4" })}
      <span className="pointer-events-none absolute -top-10 right-0 z-10 whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl ring-1 ring-white/10 transition duration-200 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

function TranscriptView({
  item,
  mode,
  text
}: {
  item: SessionItem;
  mode: ViewMode;
  text: string;
}) {
  if (mode === "paragraphs" && item.paragraphs?.length) {
    return (
      <div className="animate-[fadeIn_220ms_ease-out] space-y-5">
        {item.paragraphs.map((paragraph) => (
          <article className="rounded-xl bg-black/16 p-5 shadow-[0_12px_34px_rgba(0,0,0,0.12)]" key={`${paragraph.start}-${paragraph.end}`}>
            <div className="mb-2 text-xs font-medium text-slate-500">
              {formatTimestamp(paragraph.start)}
            </div>
            <p className="select-text whitespace-pre-wrap text-[17px] leading-[1.8] text-slate-100">{paragraph.text}</p>
          </article>
        ))}
      </div>
    );
  }

  if (mode === "speakers" && item.data?.utterances?.length) {
    return (
      <div className="animate-[fadeIn_220ms_ease-out] space-y-4">
        {item.data.utterances.map((utterance) => (
          <article className="rounded-xl bg-black/16 p-5 shadow-[0_12px_34px_rgba(0,0,0,0.12)]" key={`${utterance.start}-${utterance.end}`}>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-sm font-semibold text-teal-200">
              <Users className="h-4 w-4" />
              Speaker {utterance.speaker}
            </div>
            <p className="select-text whitespace-pre-wrap text-[17px] leading-[1.8] text-slate-100">{utterance.text}</p>
          </article>
        ))}
      </div>
    );
  }

  if (mode === "timestamps" && item.data?.utterances?.length) {
    return (
      <div className="animate-[fadeIn_220ms_ease-out] space-y-2 font-mono text-sm leading-7 text-slate-200">
        {item.data.utterances.map((utterance) => (
          <div className="grid gap-3 border-b border-white/8 py-3 sm:grid-cols-[92px_minmax(0,1fr)]" key={`${utterance.start}-${utterance.end}`}>
            <span className="text-teal-300">[{formatTimestamp(utterance.start)}]</span>
            <span className="select-text">{utterance.text}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <article className="animate-[fadeIn_220ms_ease-out] select-text whitespace-pre-wrap text-[17px] leading-[1.8] text-slate-100">
      {text}
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-sm text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-slate-400">
        <FileText className="h-5 w-5" />
      </div>
      <p className="text-sm leading-6 text-slate-400">{text}</p>
    </div>
  );
}
