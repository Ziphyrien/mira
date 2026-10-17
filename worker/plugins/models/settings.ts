import type { Sql } from "../../core/storage";
import {
  AI_PROVIDERS,
  KEY_PROVIDERS,
  AiConfigInput,
  type AiAdminState,
  type AiModelInfo,
} from "../../../src/lib/contracts";
import type { AiConfiguration } from "./api";
import { createModelRegistry, describeModel } from "./catalog";
/** Global settings live only in Directory's private SQLite; public reads never include keys. */
export class AiSettings {
  constructor(private sql: Sql) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL)",
    );
    sql.exec(
      "INSERT OR IGNORE INTO ai_settings (id, data) VALUES (1, ?)",
      JSON.stringify({ keys: {}, chat: null, memory: null }),
    );
  }
  read(): AiConfiguration {
    return JSON.parse(
      this.sql.exec<{ data: string }>("SELECT data FROM ai_settings WHERE id = 1").one().data,
    ) as AiConfiguration;
  }
  admin(): AiAdminState {
    const config = this.read(),
      models = createModelRegistry(config.keys);
    return {
      chat: config.chat,
      memory: config.memory,
      keys: {
        radius: Boolean(config.keys.radius),
        deepseek: Boolean(config.keys.deepseek),
        mimo: Boolean(config.keys.mimo),
        tavily: Boolean(config.keys.tavily),
      },
      catalog: AI_PROVIDERS.flatMap((provider) =>
        models
          .getModels(provider.id)
          .map((model) => describeModel(models, { provider: provider.id, modelId: model.id })),
      ),
    };
  }
  chatModel(): AiModelInfo | null {
    const config = this.read();
    if (!config.chat || !config.keys[config.chat.provider]) return null;
    return describeModel(createModelRegistry(config.keys), config.chat);
  }
  save(input: unknown): { ok: true; state: AiAdminState } | { ok: false; message: string } {
    const parsed = AiConfigInput.safeParse(input);
    if (!parsed.success) return { ok: false, message: "模型设置格式不正确。" };
    const config = this.read(),
      keys = { ...config.keys };
    for (const provider of KEY_PROVIDERS) {
      const change = parsed.data.keys[provider.id];
      if (change === null) delete keys[provider.id];
      else if (change !== undefined) keys[provider.id] = change;
    }
    const models = createModelRegistry(keys);
    for (const choice of [parsed.data.chat, parsed.data.memory]) {
      if (!models.getModel(choice.provider, choice.modelId))
        return { ok: false, message: "所选模型不在供应商的内置列表中。" };
      if (!keys[choice.provider])
        return {
          ok: false,
          message: `请填写 ${AI_PROVIDERS.find((provider) => provider.id === choice.provider)!.name} 的 API Key。`,
        };
    }
    this.sql.exec(
      "UPDATE ai_settings SET data = ? WHERE id = 1",
      JSON.stringify({ keys, chat: parsed.data.chat, memory: parsed.data.memory }),
    );
    return { ok: true, state: this.admin() };
  }
}
