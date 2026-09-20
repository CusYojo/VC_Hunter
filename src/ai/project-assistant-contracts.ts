export interface ProjectKnowledgeSource {
  id: string;
  type: "document" | "knowledge";
  title: string;
  href: string;
  parseStatus: string;
  availability: "ready" | "pending" | "failed" | "empty" | "omitted";
  truncated: boolean;
  reference?: string;
}
export interface ProjectAssistantRun {
  id: string; prompt: string; status: "running" | "succeeded" | "failed";
  output: string; error: string | null; provider: string; model: string;
  sources: ProjectKnowledgeSource[]; warnings: string[];
  usage: { inputTokens?: number; outputTokens?: number };
  createdAt: string; updatedAt: string;
}
export interface ProjectAssistantView { runs: ProjectAssistantRun[]; sources: ProjectKnowledgeSource[]; }
