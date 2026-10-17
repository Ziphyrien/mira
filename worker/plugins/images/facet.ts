import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpaceScope } from "../../core/storage";
import { ProfileData } from "../profile/api";
import { Images } from "./store";
import { ImageStore, ImageCommands } from "./api";
export function imagesFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.images",
    ...defineFacet(
      (api) => {
        api.serve(ImageStore, (_input, _principal, self) => {
          const imagesResource = self.resource("images", {
            version: 1,
            open: () => new Images(scope.storage.sql),
          });
          return { store: self.expose(imagesResource) };
        });
        api.serve(ImageCommands, (_input, _principal, self) => {
          const images = self.get(ImageStore, {}),
            profile = self.get(ProfileData, {});
          return {
            upload: async (data, ctx) => {
              if (!(await profile.get(null, ctx)))
                return { ok: false as const, status: 401, message: "请先进入你的账户" };
              const model = await scope.directory.chatModel();
              scope.assert();
              if (!(await profile.get(null, ctx)))
                return { ok: false as const, status: 401, message: "请先进入你的账户" };
              if (!model?.supportsImages)
                return { ok: false as const, status: 409, message: "当前日常模型不支持图片。" };
              const image = images.store!.put(data);
              return image
                ? { ok: true as const, image }
                : { ok: false as const, status: 400, message: "图片格式不正确，请重新选择图片。" };
            },
            read: (id) => images.store!.get(id),
          };
        });
      },
      { uses: [ImageStore, ProfileData] },
    ),
  };
}
