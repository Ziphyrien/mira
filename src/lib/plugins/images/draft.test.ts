import { describe, it, expect, vi } from "vite-plus/test";
import {
  ImageDraftController,
  type ImageUrlPort,
  type ImageDraftTransport,
} from "#lib/plugins/images/draft.js";
import type { ImageInfo } from "#lib/contracts/index.js";

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ImageDraftController", () => {
  it("image switching revokes URLs and aborts stale upload", async () => {
    const urlsCreated: string[] = [];
    const urlsRevoked: string[] = [];
    let urlCounter = 0;

    const fakeUrlPort: ImageUrlPort = {
      createObjectURL: () => {
        const u = `blob:test-url-${++urlCounter}`;
        urlsCreated.push(u);
        return u;
      },
      revokeObjectURL: (u: string) => {
        urlsRevoked.push(u);
      },
    };

    const firstUploadDeferred = createDeferred<ImageInfo>();
    let firstSignal: AbortSignal | undefined;

    const transport: ImageDraftTransport = {
      upload: vi.fn((_blob: Blob, signal?: AbortSignal) => {
        firstSignal = signal;
        return firstUploadDeferred.promise;
      }),
    };

    const controller = new ImageDraftController({
      model: { supportsImages: true },
      urlPort: fakeUrlPort,
      transport,
    });

    const blobA = new Blob(["image-a"], { type: "image/jpeg" });
    const blobB = new Blob(["image-b"], { type: "image/jpeg" });

    controller.pick(blobA);
    expect(controller.snapshot.url).toBe("blob:test-url-1");
    expect(urlsCreated).toEqual(["blob:test-url-1"]);

    const uploadPromise = controller.upload();
    expect(controller.snapshot.uploading).toBe(true);

    controller.pick(blobB);

    expect(urlsRevoked).toEqual(["blob:test-url-1"]);
    expect(controller.snapshot.url).toBe("blob:test-url-2");
    expect(controller.snapshot.blob).toBe(blobB);

    expect(firstSignal?.aborted).toBe(true);

    firstUploadDeferred.resolve({ id: "stale-img", width: 100, height: 100 });
    const staleResult = await uploadPromise;

    expect(staleResult).toBeNull();
    expect(controller.snapshot.error).toBeNull();
    expect(controller.snapshot.blob).toBe(blobB);
  });

  it("capability gate denies upload and picks", async () => {
    const transport: ImageDraftTransport = {
      upload: vi.fn(async () => ({ id: "uploaded", width: 200, height: 200 })),
    };

    const controller = new ImageDraftController({
      model: { supportsImages: false },
      transport,
    });

    const blob = new Blob(["dummy"], { type: "image/jpeg" });
    const picked = controller.pick(blob);

    expect(picked).toBe(false);
    expect(controller.snapshot.blob).toBeNull();
    expect(controller.snapshot.error).toBe("当前日常模型不支持读图。");

    const uploadRes = await controller.upload();
    expect(uploadRes).toBeNull();
    expect(transport.upload).not.toHaveBeenCalled();

    controller.setModel({ supportsImages: true });
    expect(controller.snapshot.supportsImages).toBe(true);
    controller.pick(blob);
    expect(controller.snapshot.blob).toBe(blob);
    expect(controller.snapshot.error).toBeNull();

    controller.setModel({ supportsImages: false });
    expect(controller.snapshot.blob).toBeNull();
    expect(controller.snapshot.url).toBeNull();
    expect(controller.snapshot.error).toBe("当前日常模型不支持读图，待发送图片已移除。");
  });

  it("dispose aborts active upload and revokes URL", () => {
    const urlsRevoked: string[] = [];
    const fakeUrlPort: ImageUrlPort = {
      createObjectURL: () => "blob:to-revoke",
      revokeObjectURL: (u) => urlsRevoked.push(u),
    };

    let capturedSignal: AbortSignal | undefined;
    const deferred = createDeferred<ImageInfo>();
    const transport: ImageDraftTransport = {
      upload: vi.fn((_b, signal) => {
        capturedSignal = signal;
        return deferred.promise;
      }),
    };

    const controller = new ImageDraftController({
      model: { supportsImages: true },
      urlPort: fakeUrlPort,
      transport,
    });

    controller.pick(new Blob(["x"], { type: "image/jpeg" }));
    void controller.upload();
    expect(controller.snapshot.uploading).toBe(true);

    controller.dispose();

    expect(capturedSignal?.aborted).toBe(true);
    expect(urlsRevoked).toEqual(["blob:to-revoke"]);
    expect(controller.snapshot.blob).toBeNull();
    expect(controller.snapshot.url).toBeNull();
  });

  it("separate instances do not leak state", () => {
    const a = new ImageDraftController({ model: { supportsImages: true } });
    const b = new ImageDraftController({ model: { supportsImages: false } });

    const blob = new Blob(["a"], { type: "image/jpeg" });
    a.pick(blob);

    expect(a.snapshot.blob).toBe(blob);
    expect(b.snapshot.blob).toBeNull();
    expect(b.snapshot.supportsImages).toBe(false);

    a.dispose();
    expect(a.snapshot.blob).toBeNull();
    expect(b.snapshot.blob).toBeNull();
  });
});
