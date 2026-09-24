export type AssemblyWord = {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: string | null;
};

export type AssemblyUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
  words?: AssemblyWord[];
};

export type AssemblyChapter = {
  gist?: string;
  headline?: string;
  summary?: string;
  start: number;
  end: number;
};

export type TranscriptData = {
  id: string;
  status: string;
  text?: string;
  words?: AssemblyWord[];
  utterances?: AssemblyUtterance[];
  chapters?: AssemblyChapter[];
  language_code?: string;
  audio_duration?: number;
  error?: string;
};

export type Paragraph = {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  words?: AssemblyWord[];
};

export type ParagraphsResponse = {
  paragraphs: Paragraph[];
};

export type ApiError = {
  error: string;
};
