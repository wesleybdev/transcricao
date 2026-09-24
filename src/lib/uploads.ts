export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;
export const LARGE_UPLOAD_BYTES = 200 * 1024 ** 2;
export const ACCEPTED_MEDIA_TYPES = [
  "video/*",
  "audio/*",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".wmv",
  ".mpeg",
  ".mpg",
  ".3gp",
  ".ts",
  ".m2ts",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".flac",
  ".aac",
  ".wma"
].join(",");

export type UploadCandidate = {
  name: string;
  size: number;
};

export function getUploadLimitError(file: UploadCandidate) {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} excede o limite de 5 GB.`;
  }

  return undefined;
}

export function buildSelectedFilesMessage(files: UploadCandidate[]) {
  const count = files.length;
  const label = `${count} ${count === 1 ? "arquivo selecionado" : "arquivos selecionados"}.`;

  if (files.some((file) => file.size > LARGE_UPLOAD_BYTES)) {
    return `${label} Arquivos grandes podem levar bastante tempo para enviar.`;
  }

  return label;
}