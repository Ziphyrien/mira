import { abortable, requestSignal } from "#lib/app/cancellation.js";
import type { ImageInfo, AiModelInfo } from "#lib/contracts/index.js";
import { IMAGE_MIME } from "#lib/shared/images.js";
import { prepareImage } from "#lib/plugins/images/prepare.js";
import { http } from "#lib/app/http.js";
import type { ImageDraftSnapshot } from "./ports.js";
import type { DraftBuffer } from "#lib/plugins/drafts/ports.js";

/** Narrow transport contract for uploading draft images. */
export type ImageDraftTransport = {
  upload: (blob: Blob, signal?: AbortSignal) => Promise<ImageInfo>;
};

/** Default transport using production API endpoint. */
const defaultImageDraftTransport: ImageDraftTransport = {
  async upload(blob: Blob, signal?: AbortSignal): Promise<ImageInfo> {
    return http<ImageInfo>("/api/images", {
      method: "POST",
      headers: { "Content-Type": IMAGE_MIME },
      body: blob,
      signal,
    });
  },
};

/** Port for creating and revoking Object URLs. */
export type ImageUrlPort = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

const defaultImageUrlPort: ImageUrlPort = {
  createObjectURL(blob: Blob): string {
    return URL.createObjectURL(blob);
  },
  revokeObjectURL(url: string): void {
    URL.revokeObjectURL(url);
  },
};

/** Port for validating/resizing raw user image files before draft attachment. */
export type ImagePreparePort = (file: File, signal?: AbortSignal) => Promise<Blob>;

export type ImageDraftOptions = {
  model: Pick<AiModelInfo, "supportsImages"> | null;
  transport?: ImageDraftTransport;
  urlPort?: ImageUrlPort;
  preparePort?: ImagePreparePort;
  drafts?: DraftBuffer;
};

/**
 * Pure TypeScript observable controller managing draft image attachment,
 * format preparation, ObjectURL lifecycle, model capability gating, and upload cancellation.
 */
export class ImageDraftController {
  #blob: Blob | null = null;
  #url: string | null = null;
  #preparing = false;
  #uploading = false;
  #error: string | null = null;
  #supportsImages = false;
  #disposed = false;
  #drafts?: DraftBuffer;
  #unsubscribeDraft?: () => void;

  #transport: ImageDraftTransport;
  #urlPort: ImageUrlPort;
  #preparePort: ImagePreparePort;

  #uploadController: AbortController | null = null;
  #prepareAbort: AbortController | null = null;

  #subscribers = new Set<(snapshot: ImageDraftSnapshot) => void>();
  #snapshot: ImageDraftSnapshot;

  constructor(options: ImageDraftOptions) {
    this.#supportsImages = Boolean(options.model?.supportsImages);
    this.#transport = options.transport ?? defaultImageDraftTransport;
    this.#urlPort = options.urlPort ?? defaultImageUrlPort;
    this.#preparePort = options.preparePort ?? prepareImage;
    this.#snapshot = this.#createSnapshot();
    this.#drafts = options.drafts;
    this.#unsubscribeDraft = this.#drafts?.subscribe(({ image }) => {
      if (this.#disposed || image === this.#blob) return;
      if (image && !this.#supportsImages) {
        this.clear();
        this.#error = "当前日常模型不支持读图，待发送图片已移除。";
        this.#emit();
        return;
      }
      this.#replaceImage(image);
    });
  }

  get snapshot(): ImageDraftSnapshot {
    return this.#snapshot;
  }

  subscribe(callback: (snapshot: ImageDraftSnapshot) => void): () => void {
    this.#subscribers.add(callback);
    callback(this.#snapshot);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  setModel(model: Pick<AiModelInfo, "supportsImages"> | null): void {
    if (this.#disposed) return;
    const supported = Boolean(model?.supportsImages);
    if (this.#supportsImages === supported) return;

    this.#supportsImages = supported;
    if (!supported && (this.#blob || this.#url)) {
      this.clear();
      this.#error = "当前日常模型不支持读图，待发送图片已移除。";
      this.#emit();
    } else {
      this.#emit();
    }
  }

  pick(blob: Blob): boolean {
    if (this.#disposed) return false;
    if (!this.#supportsImages) {
      this.#error = "当前日常模型不支持读图。";
      this.#emit();
      return false;
    }

    this.#error = null;
    this.#replaceImage(blob);
    this.#drafts?.setImage(blob);
    return true;
  }

  clear(): void {
    if (this.#disposed) return;
    this.#replaceImage(null);
    this.#drafts?.setImage(null);
  }

  #replaceImage(blob: Blob | null): void {
    this.cancelUpload();
    if (this.#prepareAbort) {
      this.#prepareAbort.abort();
      this.#prepareAbort = null;
      this.#preparing = false;
    }
    if (this.#url) {
      this.#urlPort.revokeObjectURL(this.#url);
    }
    this.#blob = blob;
    this.#url = blob ? this.#urlPort.createObjectURL(blob) : null;
    this.#emit();
  }

  clearError(): void {
    if (this.#error !== null) {
      this.#error = null;
      this.#emit();
    }
  }

  async prepare(file: File, caller?: AbortSignal): Promise<Blob | null> {
    if (this.#disposed || caller?.aborted) return null;
    if (!this.#supportsImages) {
      this.#error = "当前日常模型不支持读图。";
      this.#emit();
      return null;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      this.#error = "请选择 JPG、PNG 或 WebP 图片。";
      this.#emit();
      return null;
    }

    if (file.size > 20 * 1024 * 1024) {
      this.#error = "图片不能超过 20 MB。";
      this.#emit();
      return null;
    }

    if (this.#disposed) return null;

    if (this.#prepareAbort) {
      this.#prepareAbort.abort();
    }
    // Starting a new pick is user intent: fence an in-progress saved-image restoration.
    this.#drafts?.setImage(this.#blob);
    const abort = new AbortController();
    const signal = requestSignal(abort.signal, caller);
    this.#prepareAbort = abort;
    this.#preparing = true;
    this.#error = null;
    this.#emit();

    try {
      const blob = await abortable(this.#preparePort(file, signal), signal);
      if (this.#disposed || signal.aborted || this.#prepareAbort !== abort) {
        return null;
      }
      if (!this.#supportsImages) {
        this.#error = "当前日常模型不支持读图。";
        return null;
      }
      this.pick(blob);
      return blob;
    } catch (err) {
      if (!signal.aborted && this.#prepareAbort === abort) {
        this.#error = err instanceof Error ? err.message : "暂时无法处理图片。";
      }
      return null;
    } finally {
      if (this.#prepareAbort === abort) {
        this.#prepareAbort = null;
        this.#preparing = false;
        this.#emit();
      }
    }
  }

  async upload(caller?: AbortSignal): Promise<ImageInfo | null> {
    if (this.#disposed || caller?.aborted) return null;
    const photo = this.#blob;
    if (!photo) return null;

    if (!this.#supportsImages) {
      this.#error = "当前日常模型不支持读图。";
      this.#emit();
      return null;
    }

    this.cancelUpload();

    const controller = new AbortController();
    const signal = requestSignal(controller.signal, caller);
    this.#uploadController = controller;
    this.#uploading = true;
    this.#error = null;
    this.#emit();

    try {
      const info = await abortable(this.#transport.upload(photo, signal), signal);
      if (signal.aborted || this.#blob !== photo) {
        return null;
      }
      return info;
    } catch (err) {
      if (signal.aborted || this.#blob !== photo) {
        return null;
      }
      this.#error = err instanceof Error ? err.message : "图片上传失败，请重试。";
      return null;
    } finally {
      if (this.#uploadController === controller) {
        this.#uploadController = null;
        this.#uploading = false;
        this.#emit();
      }
    }
  }

  cancelUpload(): void {
    if (this.#uploadController) {
      this.#uploadController.abort();
      this.#uploadController = null;
      this.#uploading = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeDraft?.();
    this.cancelUpload();
    if (this.#prepareAbort) {
      this.#prepareAbort.abort();
      this.#prepareAbort = null;
    }
    if (this.#url) {
      this.#urlPort.revokeObjectURL(this.#url);
    }
    this.#blob = null;
    this.#url = null;
    this.#preparing = false;
    this.#uploading = false;
    this.#snapshot = this.#createSnapshot();
    this.#subscribers.clear();
  }

  #createSnapshot(): ImageDraftSnapshot {
    return Object.freeze({
      blob: this.#blob,
      url: this.#url,
      preparing: this.#preparing,
      uploading: this.#uploading,
      error: this.#error,
      supportsImages: this.#supportsImages,
    });
  }

  #emit(): void {
    this.#snapshot = this.#createSnapshot();
    for (const sub of this.#subscribers) {
      sub(this.#snapshot);
    }
  }
}
