/** Cross-runtime HTTP/NDJSON contracts. Feature implementations belong to their hosts. */
export { FOCUS, STYLES, ProfileInput, type Profile } from "./profile.js";
export {
  THINKING,
  AI_PROVIDERS,
  KEY_PROVIDERS,
  ModelChoice,
  AiConfigInput,
  type KeyProvider,
  type AiModelInfo,
  type AiAdminState,
} from "./models.js";
export { VOICES, SpeechPreferences, DEFAULT_SPEECH } from "./speech.js";
export { ImageId, type ImageInfo } from "./images.js";
export { KeyInput, LoginInput } from "./identity.js";
export { type SearchSource, type SearchActivity } from "./search.js";
export { type Row, type HistoryPage } from "./messages.js";
export { ChatInput, StopInput, type ChatReply, type StreamEvent } from "./chat.js";
export { type MemoryTreeNode, type MemoryTreePage, type MemoryTree } from "./memory.js";
export { type SpaceState } from "./space.js";
export { type SpaceSummary, type SpaceDetail } from "./admin.js";
