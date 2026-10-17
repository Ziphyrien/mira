import { describe, expect, it } from "vite-plus/test";
import {
  AiConfigInput,
  ChatInput,
  ImageId,
  KeyInput,
  LoginInput,
  ModelChoice,
  ProfileInput,
  SpeechPreferences,
  StopInput,
} from "./index.js";

const model = { provider: "radius", modelId: "chat-model" };
const request = {
  prompt: { kind: "message", text: " hello " },
  requestId: "request_1",
  thinking: "high",
  model,
};
const profile = { name: " Mira ", focus: [], style: "balanced", timezone: "UTC" };
const image = "550e8400-e29b-41d4-a716-446655440000";

describe("HTTP wire contracts", () => {
  it("normalizes profiles while retaining optional focus and non-strict ingress", () => {
    expect(ProfileInput.parse({ ...profile, extra: true })).toEqual({
      ...profile,
      name: "Mira",
    });
    expect(ProfileInput.safeParse({ ...profile, focus: ["work", "work"] }).success).toBe(true);
    for (const change of [
      { name: " " },
      { name: "a".repeat(41) },
      { focus: ["unknown"] },
      { focus: Array(7).fill("work") },
      { style: "unknown" },
      { timezone: "invalid/timezone" },
      { timezone: "a".repeat(65) },
    ]) {
      expect(ProfileInput.safeParse({ ...profile, ...change }).success).toBe(false);
    }
  });

  it("accepts image-only messages and the two distinct regeneration prompts", () => {
    expect(ChatInput.parse(request).prompt).toEqual({ kind: "message", text: "hello" });
    expect(
      ChatInput.parse({ ...request, prompt: { kind: "message", text: " ", image } }).prompt,
    ).toEqual({ kind: "message", text: "", image });
    expect(ChatInput.parse({ ...request, prompt: { kind: "reply", replyId: 0 } }).prompt).toEqual({
      kind: "reply",
      replyId: 0,
    });
    expect(ChatInput.parse({ ...request, prompt: { kind: "question", userId: 0 } }).prompt).toEqual(
      {
        kind: "question",
        userId: 0,
      },
    );
    const empty = ChatInput.safeParse({ ...request, prompt: { kind: "message", text: " " } });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0]?.message).toBe("请输入消息或选择图片");
  });

  it("rejects ambiguous or malformed chat inputs at every strict boundary", () => {
    for (const prompt of [
      { kind: "unknown", text: "hello" },
      { kind: "message", text: "hello", extra: true },
      { kind: "message", text: "a".repeat(4001) },
      { kind: "message", text: "hello", image: "not-a-uuid" },
      { kind: "reply", replyId: -1 },
      { kind: "reply", replyId: 1.5 },
      { kind: "reply", replyId: 0, userId: 0 },
      { kind: "question", userId: -1 },
      { kind: "question", userId: 1.5 },
      { kind: "question", replyId: 0 },
    ]) {
      expect(ChatInput.safeParse({ ...request, prompt }).success).toBe(false);
    }
    expect(ChatInput.safeParse({ ...request, extra: true }).success).toBe(false);
    expect(ChatInput.safeParse({ ...request, thinking: "unknown" }).success).toBe(false);
    expect(ChatInput.safeParse({ ...request, model: { ...model, extra: true } }).success).toBe(
      false,
    );
  });

  it("uses the same logical request ID rules for chat and cancellation", () => {
    for (const requestId of ["Ab_12-xy", "a".repeat(64)]) {
      expect(ChatInput.safeParse({ ...request, requestId }).success).toBe(true);
      expect(StopInput.parse({ requestId })).toEqual({ requestId });
    }
    for (const requestId of ["a".repeat(7), "a".repeat(65), "has space", "中文请求编号123"]) {
      expect(ChatInput.safeParse({ ...request, requestId }).success).toBe(false);
      expect(StopInput.safeParse({ requestId }).success).toBe(false);
    }
    expect(StopInput.safeParse({ requestId: request.requestId, extra: true }).success).toBe(false);
    expect(ImageId.safeParse(image).success).toBe(true);
    expect(ImageId.safeParse("a".repeat(32)).success).toBe(false);
  });

  it("keeps absent, cleared and replaced provider keys distinct without widening models", () => {
    const choices = { chat: model, memory: { provider: "deepseek", modelId: "memory-model" } };
    expect(AiConfigInput.parse({ ...choices, keys: {} }).keys).toEqual({});
    expect(
      AiConfigInput.parse({ ...choices, keys: { radius: null, tavily: " search-key " } }).keys,
    ).toEqual({ radius: null, tavily: "search-key" });
    expect(ModelChoice.parse({ provider: "radius", modelId: " chat-model " })).toEqual(model);
    for (const choice of [
      { provider: "mimo", modelId: "speech-model" },
      { provider: "radius", modelId: " " },
      { provider: "radius", modelId: "a".repeat(201) },
      { ...model, extra: true },
    ])
      expect(ModelChoice.safeParse(choice).success).toBe(false);
    for (const keys of [{ radius: " " }, { radius: "a".repeat(2049) }, { unknown: "key" }])
      expect(AiConfigInput.safeParse({ ...choices, keys }).success).toBe(false);
    expect(AiConfigInput.safeParse({ ...choices, keys: {}, extra: true }).success).toBe(false);
  });

  it("validates voice preferences without coercing autoplay or accepting extra settings", () => {
    expect(SpeechPreferences.parse({ voice: "冰糖", autoPlay: true })).toEqual({
      voice: "冰糖",
      autoPlay: true,
    });
    expect(SpeechPreferences.parse({ voice: "Mia", autoPlay: false })).toEqual({
      voice: "Mia",
      autoPlay: false,
    });
    for (const input of [
      { voice: "unknown", autoPlay: true },
      { voice: "冰糖", autoPlay: "true" },
      { voice: "冰糖" },
      { voice: "冰糖", autoPlay: true, extra: true },
    ])
      expect(SpeechPreferences.safeParse(input).success).toBe(false);
  });

  it("retains key and admin token length rules and non-strict ingress", () => {
    expect(KeyInput.parse({ key: "x".repeat(16), extra: true })).toEqual({ key: "x".repeat(16) });
    expect(KeyInput.safeParse({ key: "x".repeat(64) }).success).toBe(true);
    expect(KeyInput.safeParse({ key: "x".repeat(15) }).success).toBe(false);
    expect(KeyInput.safeParse({ key: "x".repeat(65) }).success).toBe(false);
    expect(LoginInput.parse({ token: " ", extra: true })).toEqual({ token: " " });
    expect(LoginInput.safeParse({ token: "x".repeat(200) }).success).toBe(true);
    expect(LoginInput.safeParse({ token: "" }).success).toBe(false);
    expect(LoginInput.safeParse({ token: "x".repeat(201) }).success).toBe(false);
  });
});
