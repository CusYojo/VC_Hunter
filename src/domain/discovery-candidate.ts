import type { Track } from "./types";

const TRACK_KEYWORDS: Readonly<Record<Track, readonly string[]>> = {
  AI: ["人工智能", "大模型", "推理", "多模态", "rag", "ai"],
  具身智能: ["机器人", "具身", "灵巧手", "遥操作", "vla"],
  半导体: ["芯片", "半导体", "chiplet", "封装", "eda", "碳化硅"],
  核聚变: ["聚变", "托卡马克", "超导磁体", "rebcO"],
  生物医药: ["药物", "临床", "抗体", "adc", "双抗", "cgt"],
  商业航天: ["火箭", "卫星", "航天", "发动机", "星座"],
  新材料: ["新材料", "陶瓷", "电解质", "复合材料", "超导材料"],
};

export function classifyDiscoveryCandidate(text: string): { track: Track | null; keywords: string[] } {
  const normalized = text.toLocaleLowerCase("zh-CN");
  let best: { track: Track | null; keywords: string[] } = { track: null, keywords: [] };
  for (const [track, keywords] of Object.entries(TRACK_KEYWORDS) as Array<[Track, readonly string[]]>) {
    const matched = keywords.filter((keyword) => normalized.includes(keyword.toLocaleLowerCase("zh-CN")));
    if (matched.length > best.keywords.length) best = { track, keywords: matched };
  }
  return best;
}
