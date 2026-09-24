import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transcritor AI",
  description: "Painel local para transcrever vídeos e áudios"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
