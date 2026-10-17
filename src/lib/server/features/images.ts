import { error, json, type RequestHandler } from "@sveltejs/kit";
import { readBody } from "#lib/server/body.js";
import { space } from "#lib/server/space.js";
import { ImageId } from "#lib/contracts/index.js";
import { IMAGE_MIME, MAX_IMAGE_BYTES } from "#lib/shared/images.js";

export const handleImagesUploadPost: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "请先进入你的账户");
  if (request.headers.get("Content-Type") !== IMAGE_MIME) error(415, "请上传 JPEG 图片");
  const bytes = await readBody(request, MAX_IMAGE_BYTES);
  const result = await space(locals.uid).uploadImage(bytes.buffer);
  if (!result.ok) error(result.status, result.message);
  return json(result.image);
};

export const handleImagesGet: RequestHandler = async ({ params, locals }) => {
  if (!locals.uid) error(401, "请先进入你的账户");
  const idParam = params.id;
  if (!idParam) error(404, "图片不存在");
  const id = ImageId.safeParse(idParam);
  if (!id.success) error(404, "图片不存在");
  const image = await space(locals.uid).image(id.data);
  if (!image) error(404, "图片不存在");
  return new Response(image, {
    headers: {
      "Content-Type": IMAGE_MIME,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
