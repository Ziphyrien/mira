import { z } from "zod";
import type { ResearchPlan, StudyResults } from "./research";
export const AnalysisText = z
  .object({
    overview: z.string().min(1).max(12000),
    sections: z
      .array(
        z
          .object({ title: z.string().min(1).max(160), text: z.string().min(1).max(12000) })
          .strict(),
      )
      .max(20),
    limitations: z.array(z.string().min(1).max(2000)).max(20),
    nextSteps: z.array(z.string().min(1).max(2000)).max(20),
  })
  .strict();
export type AnalysisText = z.infer<typeof AnalysisText>;
export type AnalysisSnapshot = {
  studyId: string;
  version: string;
  closedAt: number;
  plan: ResearchPlan;
  results: StudyResults;
  texts: { questionId: string; prompt: string; source: "core" | "probe"; text: string }[];
};
export type ResearchAnalysis = {
  id: string;
  closedAt: number;
  createdAt: number;
  status: "queued" | "generating" | "ready" | "failed";
  sessions: number;
  answers: number;
  version: string;
  completedAt?: number;
  report?: AnalysisText;
  error?: string;
  model?: string;
  cost?: number;
};
export type AnalyzeResearch = (
  snapshot: AnalysisSnapshot,
  signal?: AbortSignal,
) => Promise<{ report: AnalysisText; model: string; cost: number }>;
