import { z } from "zod";
import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { getAppDatabase } from "@/db/app";
import { dataResponse,errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { createPersonalModelGateway,PersonalAIRequiredError } from "@/ai/personal-model";
import { createProjectAssistantRun,getProjectAssistantView,ProjectAssistantError } from "@/ai/project-assistant";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(request:Request,{params}:{params:Promise<{id:string}>}){
  const owner=identityScope.getStore();if(!owner)return errorResponse(request,401,"AUTH_REQUIRED","请先登录。");
  try{
    const{id}=await params;const db=getAppDatabase();
    if(request.method==="GET")return dataResponse(request,getProjectAssistantView(db,owner,id));
    const input=JSON.parse((await readAIBody(request,40000)).toString("utf8"));
    const run=await createProjectAssistantRun(db,owner,id,input,request.headers.get("idempotency-key")??"",()=>createPersonalModelGateway(db,owner));
    return dataResponse(request,run,{status:run.status==="failed"?502:200});
  }catch(error){
    if(error instanceof ProjectAssistantError)return errorResponse(request,error.code==="PROJECT_NOT_FOUND"?404:error.code==="INVALID_IDENTITY"?401:409,error.code,error.message);
    if(error instanceof PersonalAIRequiredError)return errorResponse(request,409,error.code,error.message);
    if(error instanceof RangeError)return errorResponse(request,413,"PAYLOAD_TOO_LARGE","问题内容过长。");
    if(error instanceof z.ZodError||error instanceof SyntaxError)return errorResponse(request,400,"INVALID_INPUT","请输入问题，并确认同意将本次问题与相关项目资料发送给自己的模型。");
    return errorResponse(request,502,"PROJECT_AI_FAILED","项目问答暂不可用，请稍后重试。");
  }
}
export const GET=withApiAuth(handle);
export const POST=withApiAuth(handle);
