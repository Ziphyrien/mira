export { SEARCH_TOOL, SEARCH_INSTRUCTIONS } from "./prompt";
import { local } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
export const SearchExtension = local("mira.search.extension", {
  version: 1,
  input: Type.Object({}),
});
