import type { Directory } from "@/organization/contracts";

export const organizationFixture: Directory = {
  departments: [
    { id: "d1", name: "投资部", parentId: null, expectedHeadcount: null, notes: "", sortOrder: 0, version: 1 },
    { id: "d2", name: "研究组", parentId: "d1", expectedHeadcount: 3, notes: "名单待补", sortOrder: 1, version: 2 },
  ],
  members: [
    { id: "m1", accountId: "a1", name: "张明", username: "zhangming", title: "投资经理", departmentId: "d1", phone: "13800000000", email: "zhang@example.com", wechat: "zhang", active: true, roles: ["org_admin", "investment_manager"], isPlaceholder: false, sourceNotes: "组织截图", version: 2 },
    { id: "m2", accountId: "a2", name: "李研", username: "liyan", title: "研究员", departmentId: "d2", phone: "", email: "", wechat: "", active: true, roles: ["researcher"], isPlaceholder: false, sourceNotes: "组织截图", version: 3 },
    { id: "m3", accountId: null, name: "人事主管", username: null, title: "待补充姓名", departmentId: null, phone: "", email: "", wechat: "", active: true, roles: [], isPlaceholder: true, sourceNotes: "占位，未开户", version: 1 },
  ],
};
