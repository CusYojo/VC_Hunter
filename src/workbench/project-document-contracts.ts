/** Public metadata only: storage keys and filesystem paths never enter this contract. */
export interface ProjectDocumentView {
  id: string;
  projectId: string;
  originalName: string;
  kind: string;
  mediaType: string;
  byteLength: number;
  externalPolicy: string;
  parseStatus: string;
  analysisStatus: string;
  createdAt: string;
  reviewStatus?: DocumentReviewStatus;
}
export type DocumentReviewStatus = "pending" | "approved" | "changes_requested";
export type DocumentAnnotationAction = "comment" | "approve" | "request_changes";
export interface DocumentAnnotation {
  deletedAt?: string | null; canDelete?: boolean;
  id: string;
  documentId: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  content: string;
  action: DocumentAnnotationAction;
  createdAt: string;
}
export interface DocumentAnnotationsResponse {
  items: DocumentAnnotation[];
  reviewStatus: DocumentReviewStatus;
  permissions: { canComment: boolean; canReview: boolean };
}
