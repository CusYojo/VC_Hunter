export interface CandidateSource { title: string; url: string; publishedAt: string | null }
export interface CandidateView {
  id: string; companyName: string; track: string; investorNames: string[]; signalType: string; summary: string;
  confidence: number | null; status: string; version: number; lead: { title: string; url: string; publishedAt: string | null; publicationVerifiedAt?: string | null };
  projectId: string | null; createdAt: string;
  origin?: "manual_screenshot" | "ai";
  eventDate?: string | null; round?: string | null; amountText?: string | null; valuation?: string | null;
  rawTrack?: string | null; eventType?: string | null; sources?: CandidateSource[]; verificationNotes?: string | null;
  sourceScreenshot?: string | null; sourceRow?: string | null;
  archivedAt?: string | null; archiveReason?: string | null; queueRank?: number; reviewedAt?: string | null;
}
