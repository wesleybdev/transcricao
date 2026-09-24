import { NextResponse } from "next/server";
import { createTranscript, uploadMedia } from "@/lib/assemblyai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const uploadUrl = await uploadMedia(buffer);
    const transcript = await createTranscript(uploadUrl);

    return NextResponse.json({ transcript_id: transcript.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}
