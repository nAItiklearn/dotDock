// Run with `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OWNER_PHOTOS_FLAG, ownerPhotosOn, pickPhoto } from "../src/lib/photos.ts";

describe("owner photos flag", () => {
  it("is off unless the flag is exactly 1", () => {
    assert.equal(ownerPhotosOn({}), false);
    assert.equal(ownerPhotosOn({ [OWNER_PHOTOS_FLAG]: "true" }), false);
    assert.equal(ownerPhotosOn({ [OWNER_PHOTOS_FLAG]: "0" }), false);
    assert.equal(ownerPhotosOn({ [OWNER_PHOTOS_FLAG]: "1" }), true);
  });
  it("shows the project's picture while the flag is off, even with photos present", () => {
    assert.equal(pickPhoto(false, { "a.jpg": "A" }, 0), null);
  });
  it("shows the project's picture when no photo file is there", () => {
    assert.equal(pickPhoto(true, {}, 0), null);
  });
  it("takes the owner's photos in file-name order and wraps", () => {
    const photos = { "/private-photos/b.jpg": "B", "/private-photos/a.jpg": "A" };
    assert.equal(pickPhoto(true, photos, 0), "A");
    assert.equal(pickPhoto(true, photos, 1), "B");
    assert.equal(pickPhoto(true, photos, 2), "A");
  });
});
