import { describe, expect, it } from "vitest";
import {
  TARGET_MAX_SECONDS,
  TARGET_MIN_SECONDS,
  addEmptyScene,
  buildSceneSetFromTranscript,
  calculateSpeechDuration,
  calculateTotalDuration,
  copyAllPromptsText,
  countWords,
  deleteScene,
  generateVeoPrompt,
  segmentTranscript,
  updateSceneText
} from "./scenes";

function joined(scenes: ReturnType<typeof segmentTranscript>) {
  return scenes.map((scene) => scene.text).join(" ").replace(/\s+/g, " ").trim();
}

function normalized(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

describe("scene utilities", () => {
  it("keeps a copy shorter than six seconds as one scene", () => {
    const scenes = segmentTranscript("Hello, how are you?");
    expect(scenes).toHaveLength(1);
    expect(scenes[0].text).toBe("Hello, how are you?");
    expect(scenes[0].estimatedDuration).toBeLessThan(TARGET_MIN_SECONDS);
  });

  it("groups short sentences to reach the target speech range", () => {
    const text = "It did not work. You got lucky. This next line adds enough words for timing and stays natural.";
    const scenes = segmentTranscript(text);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].estimatedDuration).toBeGreaterThanOrEqual(TARGET_MIN_SECONDS);
    expect(scenes[0].estimatedDuration).toBeLessThanOrEqual(TARGET_MAX_SECONDS);
  });

  it("allows three or more short sentences in one scene when needed", () => {
    const text = "One works well. Two also works. Three follows naturally. Four makes the timing better.";
    const scenes = segmentTranscript(text);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].text).toBe(normalized(text));
  });

  it("does not create intermediate scenes below six seconds when enough copy exists", () => {
    const text = "I put Vicks on it because I saw online that it helps with blood flow. It did not work. If it just did not work you got lucky because that product can irritate sensitive skin quickly. This final line keeps the next scene balanced and natural for video.";
    const scenes = segmentTranscript(text);
    expect(scenes.slice(0, -1).every((scene) => scene.estimatedDuration >= TARGET_MIN_SECONDS)).toBe(true);
  });

  it("keeps automatic scenes within the useful speech window", () => {
    const text = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twentyone. Second scene keeps balanced timing with enough words for a useful video prompt that still leaves safe margins.";
    const scenes = segmentTranscript(text);
    expect(scenes.every((scene) => scene.estimatedDuration <= TARGET_MAX_SECONDS)).toBe(true);
  });

  it("splits a long sentence naturally", () => {
    const text = "Vicks contains camphor and menthol, and on sensitive tissue it can irritate the skin badly enough that the sensation feels alarming instead of helpful, especially when people keep applying more because they think the burning means it is working.";
    const scenes = segmentTranscript(text);
    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.every((scene) => scene.estimatedDuration <= TARGET_MAX_SECONDS)).toBe(true);
  });

  it("rebalances a short final scene when previous scenes can share content", () => {
    const text = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour thirtyfive thirtysix thirtyseven thirtyeight thirtynine forty fortyone fortytwo fortythree fortyfour fortyfive fortysix fortyseven fortyeight fortynine fifty fiftyone fiftytwo fiftythree fiftyfour fiftyfive fiftysix fiftyseven.";
    const scenes = segmentTranscript(text);
    expect(scenes).toHaveLength(3);
    expect(scenes.every((scene) => scene.estimatedDuration >= TARGET_MIN_SECONDS)).toBe(true);
    expect(scenes.every((scene) => scene.estimatedDuration <= TARGET_MAX_SECONDS)).toBe(true);
  });

  it("does not repeat or lose text", () => {
    const text = "First line has several useful words for the opening scene. Second line continues with more detail and keeps the order intact. Third line finishes the example without removing anything from the original copy.";
    const scenes = segmentTranscript(text);
    expect(joined(scenes)).toBe(normalized(text));
  });

  it("normalizes line breaks and duplicate spaces", () => {
    const text = "First   line has enough words to continue.\nSecond line adds more words for timing.";
    const scenes = segmentTranscript(text);
    expect(joined(scenes)).toBe(normalized(text));
  });

  it("ignores punctuation as extra words", () => {
    expect(countWords("Hello,   how   are you?")).toBe(4);
  });

  it("updates manual edits and recalculates metrics without rebalancing other scenes", () => {
    const scenes = segmentTranscript("This scene has enough words to be useful for a short generated video. Another sentence keeps timing in range.");
    const updated = updateSceneText(scenes, scenes[0].id, "Short edited line for testing.");
    expect(updated[0].text).toBe("Short edited line for testing.");
    expect(updated[0].wordCount).toBe(5);
    expect(updated[0].estimatedDuration).toBe(1.7);
  });

  it("calculates duration from three words per second", () => {
    expect(calculateSpeechDuration("one two three six")).toBe(1.3);
  });

  it("calculates total duration", () => {
    const scenes = segmentTranscript("One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen eighteen. Another line adds enough words for the same scene.");
    expect(calculateTotalDuration(scenes)).toBe(
      Number(scenes.reduce((total, scene) => total + scene.estimatedDuration, 0).toFixed(1))
    );
  });

  it("deletes a scene and renumbers the rest", () => {
    const scenes = segmentTranscript("One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twentyone. Second scene has enough words to stay useful after deleting the first one and keep scene order intact.");
    const updated = deleteScene(scenes, scenes[0].id);
    expect(updated[0].order).toBe(1);
    expect(updated.map((scene) => scene.text)).not.toContain(scenes[0].text);
  });

  it("adds an empty scene", () => {
    const scenes = addEmptyScene(segmentTranscript("One two three."));
    expect(scenes.at(-1)?.text).toBe("");
    expect(scenes.at(-1)?.order).toBe(2);
  });

  it("builds a persistent scene set from a transcript", () => {
    const set = buildSceneSetFromTranscript({
      sourceTranscriptId: "abc",
      sourceName: "clip.mp4",
      sourceText: "One scene."
    });
    expect(set.sourceTranscriptId).toBe("abc");
    expect(set.scenes).toHaveLength(1);
    expect(set.hasManualEdits).toBe(false);
  });

  it("generates a Veo prompt containing the exact scene text, safety margins, and no music rule", () => {
    const prompt = generateVeoPrompt('Like this video and comment "recipe."');
    expect(prompt).toContain('FALA DO AVATAR:\n\n"Like this video and comment "recipe.""');
    expect(prompt).toContain("O vídeo começa com aproximadamente 0,5 segundo de silêncio");
    expect(prompt).toContain("Toda a fala deve ser completamente concluída até aproximadamente 7,5 segundos");
    expect(prompt).toContain("A pausa deve existir SOMENTE no início e no final");
    expect(prompt).not.toContain("começar a falar exatamente no segundo 0");
    expect(prompt).not.toContain("sem silêncio inicial");
    expect(prompt).toContain("Não usar música de fundo");
    expect(prompt).toContain("somente sons ambientes naturais do local");
    expect(prompt).not.toContain("cenário");
  });

  it("copies all prompts in scene order", () => {
    const scenes = segmentTranscript("One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twentyone. Second scene has enough words to make another prompt useful and preserve the exported order with clear stable separation between generated prompts.");
    const text = copyAllPromptsText(scenes);
    expect(text).toContain("CENA 01");
    expect(text).toContain("--------------------");
  });

  it("keeps the real example balanced without tiny scenes", () => {
    const text = "I put Vicks on it because I saw online that it helps with blood flow. It did not work. If it just didn't work, you got lucky. Vicks contains camphor and menthol, and on sensitive tissue, it can even cause burns. That tingling sensation isn't better circulation, it's irritation. If you want to feel like you're in your 20s again, like this video and comment recipe, I'll send you something you can actually do to get rock solid when it matters.";
    const scenes = segmentTranscript(text);
    expect(joined(scenes)).toBe(normalized(text));
    expect(scenes.every((scene) => scene.estimatedDuration <= TARGET_MAX_SECONDS)).toBe(true);
    expect(scenes.slice(0, -1).every((scene) => scene.estimatedDuration >= TARGET_MIN_SECONDS)).toBe(true);
  });
});
