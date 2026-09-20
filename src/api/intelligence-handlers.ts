import { dataResponse, errorResponse } from "./envelope";
import type { SqliteIntelligenceRepository } from "@/repositories/intelligence";

export async function handleGetInvestors(request: Request, repository: SqliteIntelligenceRepository): Promise<Response> {
  const items = repository.listInvestors();
  return dataResponse(request, { items, total: items.length });
}

export async function handleGetInvestmentEvents(request: Request, repository: SqliteIntelligenceRepository): Promise<Response> {
  const items = repository.listInvestmentEvents();
  return dataResponse(request, { items, total: items.length });
}

export async function handleGetMaEvents(request: Request, repository: SqliteIntelligenceRepository): Promise<Response> {
  const items = repository.listMaEvents();
  return dataResponse(request, { items, total: items.length });
}

export async function handleGetPeople(request: Request, repository: SqliteIntelligenceRepository): Promise<Response> {
  const items = repository.listPeople();
  return dataResponse(request, { items, total: items.length });
}

export async function handleGetPerson(request: Request, repository: SqliteIntelligenceRepository, personId: string): Promise<Response> {
  const person = repository.findPerson(personId);
  return person ? dataResponse(request, person) : errorResponse(request, 404, "NOT_FOUND", "人物不存在。");
}

export async function handleGetPersonEvents(request: Request, repository: SqliteIntelligenceRepository): Promise<Response> {
  const items = repository.listPersonEvents();
  return dataResponse(request, { items, total: items.length });
}

export async function handleGetTopicKnowledgeCards(request: Request, repository: SqliteIntelligenceRepository): Promise<Response> {
  const items = repository.listTopicKnowledgeCards();
  return dataResponse(request, { items, total: items.length });
}
