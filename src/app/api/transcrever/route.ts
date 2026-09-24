import { NextResponse } from "next/server";
import { createTranscript, uploadMedia } from "@/lib/assemblyai";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);

    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Arquivo excede o limite de 5 GB." }, { status: 413 });
    }

    if (!request.body) {
      return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const uploadUrl = await uploadMedia(request.body, contentType);
    const transcript = await createTranscript(uploadUrl);

    return NextResponse.json({ transcript_id: transcript.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}