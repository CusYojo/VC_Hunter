"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dispatchPrototype } from "@/prototype/store";

export function PrototypeControls() {
  const [reset, setReset] = useState(false);
  return <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4"><h2 className="font-semibold text-amber-950">演示数据</h2><p className="mt-1 text-sm leading-6 text-amber-900">恢复默认角色、任务、审批、财务和工作流数据。真实 API 与数据库内容不受影响。</p><Button variant="outline" className="mt-3 min-h-11 border-amber-300 bg-white" onClick={() => { dispatchPrototype({ type: "prototype.reset" }); setReset(true); }}><RotateCcw aria-hidden="true" />重置演示数据</Button>{reset && <p role="status" className="mt-2 text-sm font-medium text-emerald-800">演示数据已恢复</p>}</section>;
}
