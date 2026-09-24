import { NextResponse } from "next/server";
import { getTranscript } from "@/lib/assemblyai";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Parâmetro id é obrigatório." }, { status: 400 });
    }

    const transcript = await getTranscript(id);

    if (transcript.status === "completed") {
      return NextResponse.json({ status: transcript.status, data: transcript });
    }

    if (transcript.status === "error") {
      return NextResponse.json(
        { status: transcript.status, error: transcript.error || "Transcrição falhou." },
        { status: 502 }
      );
    }

    return NextResponse.json({ status: transcript.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}
