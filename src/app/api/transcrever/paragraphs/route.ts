import { NextResponse } from "next/server";
import { getParagraphs } from "@/lib/assemblyai";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Parâmetro id é obrigatório." }, { status: 400 });
    }

    const paragraphs = await getParagraphs(id);
    return NextResponse.json(paragraphs);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      { status: 500 }
    );
  }
}
