import type { ParagraphsResponse, TranscriptData } from "@/lib/types";

const BASE_URL = "https://api.assemblyai.com/v2";

type AssemblyFetchInit = RequestInit & {
  duplex?: "half";
};

function getApiKey() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY não foi configurada em .env.local.");
  }

  return apiKey;
}

async function assemblyFetch<T>(path: string, init: AssemblyFetchInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: getApiKey(),
      ...init.headers
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `AssemblyAI respondeu com HTTP ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export async function uploadMedia(body: BodyInit, contentType = "application/octet-stream") {
  const response = await assemblyFetch<{ upload_url: string }>("/upload", {
    method: "POST",
    headers: {
      "Content-Type": contentType
    },
    body,
    duplex: body instanceof ReadableStream ? "half" : undefined
  });

  return response.upload_url;
}

export async function createTranscript(uploadUrl: string) {
  return assemblyFetch<{ id: string }>("/transcript", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      language_detection: true,
      speaker_labels: true,
      auto_chapters: true,
      punctuate: true,
      format_text: true
    })
  });
}

export async function getTranscript(id: string) {
  return assemblyFetch<TranscriptData>(`/transcript/${encodeURIComponent(id)}`);
}

export async function getParagraphs(id: string) {
  return assemblyFetch<ParagraphsResponse>(
    `/transcript/${encodeURIComponent(id)}/paragraphs`
  );
}

export async function getSrt(id: string) {
  const response = await fetch(`${BASE_URL}/transcript/${encodeURIComponent(id)}/srt`, {
    headers: {
      Authorization: getApiKey()
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `AssemblyAI respondeu com HTTP ${response.status}.`);
  }

  return response.text();
}