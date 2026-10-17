import { createHost } from "@earendil-works/chord";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Images } from "./api.js";
import { imagesWeb } from "./web.js";
import { draftsWeb } from "#lib/plugins/drafts/web.js";

afterEach(() => vi.unstubAllGlobals());

it("closes the image facet during native bitmap decoding and releases the late bitmap", async () => {
  const entered = Promise.withResolvers<void>();
  const decoded = Promise.withResolvers<ImageBitmap>();
  vi.stubGlobal("createImageBitmap", () => {
    entered.resolve();
    return decoded.promise;
  });
  const closeBitmap = vi.fn();
  const createElement = vi.fn();
  vi.stubGlobal("document", { createElement });
  const host = createHost({ name: "test.images.native", self: null });
  await host.load([
    draftsWeb,
    imagesWeb({
      provider: "radius",
      modelId: "vision",
      name: "Vision",
      thinking: ["off"],
      highest: "off",
      supportsImages: true,
    }),
  ]);
  const images = await host.get(Images, {});
  const prepare = images
    .prepare(new File(["image"], "image.png", { type: "image/png" }))
    .catch(() => {});
  await entered.promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      host.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("host waited for bitmap decoder")), 500);
      }),
    ]);
    await prepare;
    expect(createElement).not.toHaveBeenCalled();
  } finally {
    clearTimeout(timer);
    // Shape is deliberately only the browser resource used after cancellation.
    decoded.resolve({ close: closeBitmap, width: 1, height: 1 } as unknown as ImageBitmap);
    await decoded.promise;
    await prepare;
    await host.close();
  }
  await vi.waitFor(() => expect(closeBitmap).toHaveBeenCalledOnce());
  expect(createElement).not.toHaveBeenCalled();
});
