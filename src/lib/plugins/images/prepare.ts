import { abortable } from "#lib/app/cancellation.js";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } from "#lib/shared/images.js";

/** Normalize orientation and bound pixels before sending a private image asset. */
export async function prepareImage(file: File, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MB。");
  const bitmap = await abortable(createImageBitmap(file), signal, (late) => late.close());
  try {
    signal?.throwIfAborted();
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / bitmap.width,
      MAX_IMAGE_DIMENSION / bitmap.height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("暂时无法处理图片。");
    for (;;) {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      signal?.throwIfAborted();
      const blob = await abortable(
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("暂时无法处理图片。"))),
            IMAGE_MIME,
            0.88,
          ),
        ),
        signal,
      );
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
      if (canvas.width <= 64 && canvas.height <= 64)
        throw new Error("图片处理后仍然过大，请选择另一张图片。");
      canvas.width = Math.max(1, Math.round(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.75));
    }
  } finally {
    bitmap.close();
  }
}
