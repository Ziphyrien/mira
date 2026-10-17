import { local } from "@earendil-works/chord";
import { Type } from "typebox";
export const ProfileSettingsFeature = local("mira.web.profile", {
  version: 1,
  input: Type.Object({}),
  members: {},
});
