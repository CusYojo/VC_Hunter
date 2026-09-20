import Link from "next/link";

export function ModuleUnavailable() {
  return <section className="m-6 rounded-lg border bg-white p-8"><h1 className="text-xl font-semibold">此模块尚未开放</h1><p className="mt-3 text-sm text-muted-foreground">此页面的演示操作尚未接入正式业务流程，当前已关闭。项目管理、机构追踪、待办、日程和资料审批可正常使用。</p><Link className="mt-5 inline-block text-sm text-primary" href="/">返回工作台</Link></section>;
}
