import type { ProjectKnowledgeSource } from "./project-assistant-contracts";

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface ChatTurn {
  id: string;
  conversationId: string;
  prompt: string;
  context: string;
  attachmentName: string | null;
  skill: string;
  projectId: string | null;
  useKnowledge: boolean;
  status: "running" | "succeeded" | "failed";
  output: string;
  error: string | null;
  provider: string;
  model: string;
  sources: ProjectKnowledgeSource[];
  warnings: string[];
  usage: { inputTokens?: number; outputTokens?: number };
  createdAt: string;
  updatedAt: string;
}
export interface ChatConversationView {
  conversation: ChatConversation;
  turns: ChatTurn[];
}
