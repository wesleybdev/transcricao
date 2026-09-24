export type Scene = {
  id: string;
  order: number;
  text: string;
  wordCount: number;
  estimatedDuration: number;
};

export type SceneSet = {
  id: string;
  sourceTranscriptId: string;
  sourceName: string;
  sourceText: string;
  scenes: Scene[];
  createdAt: number;
  updatedAt: number;
  hasManualEdits: boolean;
};

export const SCENES_STORAGE_KEY = "transcription-scene-sets-v1";
export const WORDS_PER_SECOND = 3;
export const TARGET_MIN_SECONDS = 6;
export const TARGET_MAX_SECONDS = 7;
export const TARGET_MIN_WORDS = TARGET_MIN_SECONDS * WORDS_PER_SECOND;
export const TARGET_MAX_WORDS = TARGET_MAX_SECONDS * WORDS_PER_SECOND;

const CONJUNCTIONS = new Set(["and", "but", "because", "so", "if", "when", "while"]);

const VEO_PROMPT_PREFIX = `A animação deve manter um único take contínuo e estável durante todo o vídeo.

Não adicionar subtitles, captions, on-screen text, titles, letterings, overlays, watermarks ou qualquer texto visível na tela. O quadro deve permanecer completamente limpo, sem elementos textuais.

O vídeo começa com aproximadamente 0,5 segundo de silêncio. Durante esse breve momento inicial, o avatar permanece naturalmente pronto para falar, sem movimento labial de fala.

Por volta de 0,5 segundo, o avatar começa a falar de forma clara e imediata.

A partir da primeira palavra, a fala deve ser rápida, contínua, natural e fluida, sem pausas, hesitações ou silêncios no meio.

Toda a fala deve ser completamente concluída até aproximadamente 7,5 segundos.

Após a última palavra, o avatar para de falar naturalmente e permanece em silêncio pelo breve tempo restante do vídeo.

A pausa deve existir SOMENTE no início e no final. Não adicionar pausas entre frases, palavras ou ideias durante a fala.

Usar sotaque natural de inglês americano.

O avatar deve falar a linha uma única vez, sem repetir palavras, frases ou trechos.

Não usar segunda voz, voz off, narrador ou qualquer outra pessoa falando.

Não adicionar fillers ou sons vocais como "hmm", "uh", "um", "mm-hmm" ou humming.

Não usar música de fundo, trilha sonora, score musical, jingle ou qualquer acompanhamento musical. Usar somente sons ambientes naturais do local, discretos e coerentes com a cena.

Os movimentos e expressões do avatar devem ser naturais, discretos e coerentes com o conteúdo da fala.

A câmera deve permanecer completamente fixa durante toda a cena.

Não usar zoom, pan, tilt, dolly, mudança de enquadramento, mudança de posição, troca de câmera, transição ou corte.

Depois que a fala começar, ela deve continuar sem interrupção até a última palavra.

Após terminar a última palavra, não repetir a fala e não iniciar uma nova frase.

FALA DO AVATAR:`;

export function normalizeSceneText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function countWords(text: string) {
  return normalizeSceneText(text).match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*/g)?.length ?? 0;
}

export function calculateSpeechDuration(text: string) {
  const raw = countWords(text) / WORDS_PER_SECOND;
  return Number(raw.toFixed(1));
}

export function formatSceneDuration(seconds: number) {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

export function calculateTotalDuration(scenes: Scene[]) {
  return Number(scenes.reduce((total, scene) => total + scene.estimatedDuration, 0).toFixed(1));
}

export function generateVeoPrompt(sceneText: string) {
  return `${VEO_PROMPT_PREFIX}

"${normalizeSceneText(sceneText)}"`;
}

export function createScene(text: string, order: number, id = createId()) {
  const normalized = normalizeSceneText(text);

  return {
    id,
    order,
    text: normalized,
    wordCount: countWords(normalized),
    estimatedDuration: calculateSpeechDuration(normalized)
  };
}

export function renumberScenes(scenes: Scene[]) {
  return scenes.map((scene, index) => ({
    ...createScene(scene.text, index + 1, scene.id)
  }));
}

export function updateSceneText(scenes: Scene[], sceneId: string, text: string) {
  return renumberScenes(
    scenes.map((scene) => (scene.id === sceneId ? createScene(text, scene.order, scene.id) : scene))
  );
}

export function addEmptyScene(scenes: Scene[]) {
  return [...scenes, createScene("", scenes.length + 1)];
}

export function deleteScene(scenes: Scene[], sceneId: string) {
  return renumberScenes(scenes.filter((scene) => scene.id !== sceneId));
}

export function buildSceneSetFromTranscript(input: {
  sourceTranscriptId: string;
  sourceName: string;
  sourceText: string;
  existingId?: string;
}) {
  const now = Date.now();

  return {
    id: input.existingId ?? createId(),
    sourceTranscriptId: input.sourceTranscriptId,
    sourceName: input.sourceName,
    sourceText: input.sourceText,
    scenes: segmentTranscript(input.sourceText),
    createdAt: now,
    updatedAt: now,
    hasManualEdits: false
  };
}

export function copyAllPromptsText(scenes: Scene[]) {
  return scenes
    .map((scene) => `CENA ${String(scene.order).padStart(2, "0")}\n\n${generateVeoPrompt(scene.text)}`)
    .join("\n\n--------------------\n\n");
}

export function segmentTranscript(text: string) {
  const normalized = normalizeSceneText(text);
  if (!normalized) return [];

  const words = normalized.split(/\s+/);
  if (words.length <= TARGET_MAX_WORDS) {
    return [createScene(normalized, 1)];
  }

  const sceneCount = chooseSceneCount(words.length);
  const splitIndexes = findBalancedSplitIndexes(words, sceneCount);
  const boundaries = [0, ...splitIndexes, words.length];

  return rebalanceScenes(
    boundaries
      .slice(0, -1)
      .map((start, index) => words.slice(start, boundaries[index + 1]).join(" "))
      .filter(Boolean)
      .map((sceneText, index) => createScene(sceneText, index + 1))
  );
}

export function rebalanceScenes(scenes: Scene[]) {
  if (scenes.length <= 1) return renumberScenes(scenes);

  const words = scenes.flatMap((scene) => scene.text.split(/\s+/).filter(Boolean));
  const sceneCount = chooseSceneCount(words.length);
  const splitIndexes = findBalancedSplitIndexes(words, sceneCount);
  const boundaries = [0, ...splitIndexes, words.length];

  return renumberScenes(
    boundaries
      .slice(0, -1)
      .map((start, index) => createScene(words.slice(start, boundaries[index + 1]).join(" "), index + 1))
  );
}

function chooseSceneCount(wordCount: number) {
  if (wordCount <= TARGET_MAX_WORDS) return 1;

  const minScenesForMax = Math.ceil(wordCount / TARGET_MAX_WORDS);
  const maxScenesForMin = Math.floor(wordCount / TARGET_MIN_WORDS);

  if (maxScenesForMin >= minScenesForMax) {
    return minScenesForMax;
  }

  return Math.max(1, maxScenesForMin);
}

function findBalancedSplitIndexes(words: string[], sceneCount: number) {
  const indexes: number[] = [];
  let start = 0;

  for (let sceneIndex = 1; sceneIndex < sceneCount; sceneIndex += 1) {
    const remainingScenes = sceneCount - sceneIndex;
    const remainingWords = words.length - start;
    const idealSize = Math.round(remainingWords / (remainingScenes + 1));
    const canKeepMinimum = remainingWords >= TARGET_MIN_WORDS * (remainingScenes + 1);
    const lower = Math.max(
      start + 1,
      words.length - remainingScenes * TARGET_MAX_WORDS,
      start + (canKeepMinimum ? TARGET_MIN_WORDS : 1)
    );
    const upper = Math.min(
      start + TARGET_MAX_WORDS,
      words.length - remainingScenes * (canKeepMinimum ? TARGET_MIN_WORDS : 1)
    );
    const desired = clamp(start + idealSize, lower, upper);
    const splitIndex = findNaturalBoundary(words, desired, lower, upper);

    indexes.push(splitIndex);
    start = splitIndex;
  }

  return indexes;
}

function findNaturalBoundary(words: string[], desired: number, lower: number, upper: number) {
  let bestIndex = desired;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = lower; index <= upper; index += 1) {
    const distance = Math.abs(index - desired);
    const score = distance * 10 + boundaryPenalty(words, index);

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function boundaryPenalty(words: string[], index: number) {
  const previous = words[index - 1] ?? "";
  const next = words[index] ?? "";

  if (/[.!?]["')\]]*$/.test(previous)) return 0;
  if (/[;:]["')\]]*$/.test(previous)) return 1;
  if (/,$/.test(previous)) return 2;
  if (CONJUNCTIONS.has(cleanWord(next).toLowerCase())) return 3;
  return 6;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanWord(word: string) {
  return word.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+|[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+$/g, "");
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
