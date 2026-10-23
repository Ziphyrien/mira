import type { AtomicStorage } from "../../core/storage";
import {
  AnalysisText,
  type AnalysisSnapshot,
  type ResearchAnalysis,
  type AnalyzeResearch,
} from "../../../src/lib/contracts/research-analysis";
export class ResearchAnalyses {
  constructor(private readonly storage: AtomicStorage) {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_analyses (id TEXT PRIMARY KEY,data TEXT NOT NULL,snapshot TEXT NOT NULL)",
    );
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_analysis_texts (analysis_id TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(analysis_id,position))",
    );
    storage.sql.exec(
      "UPDATE research_analyses SET data=json_set(data,'$.status','queued') WHERE json_extract(data,'$.status')='generating'",
    );
  }
  queue(snapshot: AnalysisSnapshot) {
    const analysis: ResearchAnalysis = {
      id: crypto.randomUUID(),
      closedAt: snapshot.closedAt,
      createdAt: Date.now(),
      status: "queued",
      sessions: snapshot.results.sessions,
      answers: snapshot.results.answers,
      version: snapshot.version,
    };
    this.storage.sql.exec(
      "INSERT INTO research_analyses VALUES(?,?,?)",
      analysis.id,
      JSON.stringify(analysis),
      JSON.stringify({ ...snapshot, texts: undefined }),
    );
    snapshot.texts.forEach((text, index) =>
      this.storage.sql.exec(
        "INSERT INTO research_analysis_texts VALUES(?,?,?)",
        analysis.id,
        index,
        JSON.stringify(text),
      ),
    );
    return analysis;
  }
  list() {
    return this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_analyses ORDER BY rowid DESC")
      .toArray()
      .map((r) => JSON.parse(r.data) as ResearchAnalysis);
  }
  pending() {
    return (
      this.storage.sql
        .exec(
          "SELECT id FROM research_analyses WHERE json_extract(data,'$.status')='queued' LIMIT 1",
        )
        .toArray().length > 0
    );
  }
  clear() {
    this.storage.sql.exec("DELETE FROM research_analysis_texts");
    this.storage.sql.exec("DELETE FROM research_analyses");
  }
  retry(id: string) {
    const row = this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_analyses WHERE id=?", id)
      .toArray()[0];
    if (!row) throw Error("分析记录不存在。");
    const data = JSON.parse(row.data) as ResearchAnalysis;
    if (data.status === "failed") {
      data.status = "queued";
      delete data.error;
      this.save(data);
    }
    return data;
  }
  private save(data: ResearchAnalysis) {
    this.storage.sql.exec(
      "UPDATE research_analyses SET data=? WHERE id=?",
      JSON.stringify(data),
      data.id,
    );
  }
  async process(analyze: AnalyzeResearch, signal?: AbortSignal) {
    const row = this.storage.sql
      .exec<{ data: string; snapshot: string }>(
        "SELECT data,snapshot FROM research_analyses WHERE json_extract(data,'$.status')='queued' ORDER BY rowid LIMIT 1",
      )
      .toArray()[0];
    if (!row) return;
    const data = JSON.parse(row.data) as ResearchAnalysis,
      snapshot = JSON.parse(row.snapshot) as AnalysisSnapshot;
    snapshot.texts = this.storage.sql
      .exec<{ data: string }>(
        "SELECT data FROM research_analysis_texts WHERE analysis_id=? ORDER BY position",
        data.id,
      )
      .toArray()
      .map((r) => JSON.parse(r.data) as AnalysisSnapshot["texts"][number]);
    data.status = "generating";
    this.save(data);
    try {
      const result =
        snapshot.results.answers === 0
          ? {
              report: {
                overview: "截至本次停止收集，尚无实质回答，无法据此分析研究问题。",
                sections: [],
                limitations: ["开始参与或跳过题目不等于提供了实质回答。"],
                nextSteps: ["可以继续收集，获得回答后再次结束并生成分析。"],
              },
              model: "descriptive",
              cost: 0,
            }
          : await analyze(snapshot, signal);
      data.report = AnalysisText.parse(result.report);
      data.model = result.model;
      data.cost = result.cost;
      data.completedAt = Date.now();
      data.status = "ready";
    } catch (error) {
      data.status = "failed";
      data.error = error instanceof Error ? error.message : "分析暂未完成，请重试。";
    }
    // UPDATE cannot resurrect a report cleared by withdrawal, expiry or deletion.
    this.save(data);
  }
}
