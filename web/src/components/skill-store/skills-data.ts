export type SkillCategory =
  | "推荐"
  | "专业影视"
  | "商业广告"
  | "短剧漫剧"
  | "动漫游戏"
  | "音乐MV"
  | "自媒体创作"
  | "通用技能"
  | "发现";

export type Skill = {
  id: string;
  title: string;
  description: string;
  author: string;
  /** Display label for the badge on the thumbnail (e.g. 视频 / 显示). */
  badge: string;
  /** Approximate user count, formatted as a short string (176 / 3.0k / 1.2w). */
  usage: string;
  category: SkillCategory;
  /** Two CSS colors used to build a gradient placeholder thumbnail. */
  palette: [string, string];
  /** A short label printed on the thumbnail to hint the theme. */
  motif: string;
};

export const SKILL_CATEGORIES: SkillCategory[] = [
  "推荐",
  "专业影视",
  "商业广告",
  "短剧漫剧",
  "动漫游戏",
  "音乐MV",
  "自媒体创作",
  "通用技能",
  "发现",
];

export const SKILLS: Skill[] = [
  {
    id: "1",
    title: "梦核美学",
    description: "从概念到成片一体化创作梦核视觉短片",
    author: "熬夜chill",
    badge: "视频",
    usage: "176",
    category: "推荐",
    palette: ["#3a2b5e", "#7c4ad0"],
    motif: "dreamcore",
  },
  {
    id: "2",
    title: "A24电影美学",
    description: "高强度运镜电影美学，以作者视角，用粗粝真实的表达包裹氛围底色",
    author: "熬夜chill",
    badge: "视频",
    usage: "493",
    category: "专业影视",
    palette: ["#4a3a1f", "#b88a3e"],
    motif: "A24",
  },
  {
    id: "3",
    title: "POP MV",
    description: "聚焦国际一线流行音乐 MV 创作体系，一句话自动完成 MV 创作",
    author: "熬夜chill",
    badge: "视频",
    usage: "124",
    category: "音乐MV",
    palette: ["#0e3a55", "#1ec3f4"],
    motif: "POP MV",
  },
  {
    id: "4",
    title: "真人感美妆 UGC 产品测评",
    description: "一键把美妆卖点变成可见证据与自限口播",
    author: "刘不任Wander",
    badge: "视频",
    usage: "105",
    category: "商业广告",
    palette: ["#3a1f3f", "#c45aa0"],
    motif: "UGC",
  },
  {
    id: "5",
    title: "选角 Casting",
    description: "你的专属选角导演，一键为你挑选最合适的角色",
    author: "苏打绿豆",
    badge: "显示",
    usage: "3.0k",
    category: "推荐",
    palette: ["#1a1a1a", "#5a5a5a"],
    motif: "casting",
  },
  {
    id: "6",
    title: "AI 模特脱口秀 skill",
    description: "自动生成模稿、场照、脱口秀文案和脚本，并输出完整的脱口秀短片",
    author: "刘不任Wander",
    badge: "视频",
    usage: "836",
    category: "推荐",
    palette: ["#5a1f1f", "#ff5a3c"],
    motif: "talk show",
  },
  {
    id: "7",
    title: "精品女频短剧一键成片",
    description: "告别粗糙流水线成片，纯精品短剧工业化全流程一键出片",
    author: "星燃AI",
    badge: "视频",
    usage: "1.2w",
    category: "短剧漫剧",
    palette: ["#2c2c3a", "#9a8acf"],
    motif: "短剧",
  },
  {
    id: "8",
    title: "韦斯安德森电影美学",
    description: "深邃还原韦氏标志性视听语言，适用 15 秒-5 分钟电影短片成广告",
    author: "omom",
    badge: "视频",
    usage: "1.9k",
    category: "专业影视",
    palette: ["#4a2c1a", "#e0a86a"],
    motif: "Wes A.",
  },
  {
    id: "9",
    title: "影视打斗特效 skill",
    description: "一句话生成角色人物影视特效，支持文字参考图/视频",
    author: "库里AG",
    badge: "视频",
    usage: "1.3k",
    category: "专业影视",
    palette: ["#3a1010", "#ff7a1a"],
    motif: "fight FX",
  },
  {
    id: "10",
    title: "苏联粗野主义",
    description: "深棕苏联粗犷美学，一键生成纪念碑式视觉大片",
    author: "翻山计划",
    badge: "视频",
    usage: "255",
    category: "推荐",
    palette: ["#3a3024", "#8a7a55"],
    motif: "USSR",
  },
  {
    id: "11",
    title: "无厘头喜剧",
    description: "将任意主题转成无厘头创意短片，支持剧本改写和图片视频。",
    author: "捏捏AI",
    badge: "视频",
    usage: "2.3k",
    category: "自媒体创作",
    palette: ["#1f3a4a", "#5fb4d4"],
    motif: "comedy",
  },
  {
    id: "12",
    title: "高机能时尚风配饰橱窗广告",
    description: "上传眼镜、手表等配饰图，自动生成节奏强、质感高级的时尚广告。",
    author: "刘不任Wander",
    badge: "视频",
    usage: "154",
    category: "商业广告",
    palette: ["#0a1a2a", "#3a8acf"],
    motif: "fashion",
  },
  {
    id: "13",
    title: "古典武侠电影全流程导演",
    description: "一键把武侠灵感转化为明金陵、邵氏、古龙韵味电影短片",
    author: "翻山计划",
    badge: "视频",
    usage: "59",
    category: "专业影视",
    palette: ["#2a1f0a", "#9a7a3a"],
    motif: "武侠",
  },
  {
    id: "14",
    title: "概念角色 SSS 级技能展示",
    description: "输入一个角色想法，自动生成原创概念设定与展示视频",
    author: "星燃AI",
    badge: "显示",
    usage: "1.1k",
    category: "动漫游戏",
    palette: ["#2a0a2a", "#b04acf"],
    motif: "SSS",
  },
  {
    id: "15",
    title: "电影质感画面专业全成",
    description: "一切大白话就能生成超质感电影感画面多风格小语风学",
    author: "小言同学",
    badge: "视频",
    usage: "829",
    category: "专业影视",
    palette: ["#1a2a1a", "#5aaa7a"],
    motif: "cinema",
  },
  {
    id: "16",
    title: "赛博朋克霓虹夜景",
    description: "一键生成霓虹闪烁的赛博朋克短片，含雨夜、烟雾、镜头语言",
    author: "熬夜chill",
    badge: "视频",
    usage: "2.7k",
    category: "专业影视",
    palette: ["#0a0a3a", "#ff3ad4"],
    motif: "cyber",
  },
  {
    id: "17",
    title: "治愈系猫咪日常",
    description: "把任意主题转成治愈系猫咪短片，温暖观众心",
    author: "捏捏AI",
    badge: "视频",
    usage: "4.2k",
    category: "自媒体创作",
    palette: ["#3a2a2a", "#e0a08a"],
    motif: "cat",
  },
  {
    id: "18",
    title: "国风水墨意境短片",
    description: "用一句话生成国风水墨意境短片，含山水、留白、印章",
    author: "omom",
    badge: "视频",
    usage: "968",
    category: "自媒体创作",
    palette: ["#0a2a2a", "#5acfcf"],
    motif: "国风",
  },
];