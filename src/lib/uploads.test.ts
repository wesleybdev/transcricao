import { describe, expect, it } from "vitest";
import {
  ACCEPTED_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
  buildSelectedFilesMessage,
  getUploadLimitError
} from "./uploads";

describe("upload helpers", () => {
  it("allows files up to five gigabytes", () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 ** 3);
    expect(getUploadLimitError({ size: MAX_UPLOAD_BYTES, name: "large-video.mkv" })).toBeUndefined();
  });

  it("rejects files larger than five gigabytes", () => {
    expect(getUploadLimitError({ size: MAX_UPLOAD_BYTES + 1, name: "too-large.mov" })).toBe(
      "too-large.mov excede o limite de 5 GB."
    );
  });

  it("accepts broad audio and video picker types", () => {
    expect(ACCEPTED_MEDIA_TYPES).toContain("video/*");
    expect(ACCEPTED_MEDIA_TYPES).toContain("audio/*");
    expect(ACCEPTED_MEDIA_TYPES).toContain(".mkv");
  });

  it("builds a large upload warning without blocking files under the limit", () => {
    expect(buildSelectedFilesMessage([{ size: 4 * 1024 ** 3, name: "movie.mkv" }])).toContain(
      "Arquivos grandes podem levar bastante tempo"
    );
  });
});