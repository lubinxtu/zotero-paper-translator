// glossary.js
// 翻译规范与术语基准（移植自 paper-translator 技能）
// 这些术语用于构建 LLM 系统提示词，约束翻译时的译名统一。

export const TERMS = [
  ["SLAM", "同步定位与地图构建"],
  ["Visual SLAM", "视觉 SLAM"],
  ["monocular / stereo", "单目 / 双目"],
  ["Bundle Adjustment (BA)", "光束法平差"],
  ["Parallel Tracking and Mapping (PTAM)", "并行跟踪与建图"],
  ["keyframe", "关键帧"],
  ["covisibility graph", "共视图"],
  ["Essential Graph", "本质图"],
  ["spanning tree", "生成树"],
  ["loop closing / loop detection", "闭环 / 回环检测"],
  ["relocalization", "重定位"],
  ["place recognition", "位置识别"],
  ["bag of words (BoW)", "词袋"],
  ["ORB", "ORB 特征"],
  ["homography", "单应矩阵"],
  ["fundamental matrix", "基础矩阵"],
  ["essential matrix", "本质矩阵"],
  ["reprojection error", "重投影误差"],
  ["parallax", "视差"],
  ["RANSAC", "RANSAC"],
  ["PnP", "PnP"],
  ["Levenberg-Marquardt (LM)", "列文伯格-马夸尔特"],
  ["pose graph", "位姿图"],
  ["motion-only BA", "仅运动 BA"],
  ["local BA / global BA / full BA", "局部 BA / 全局 BA / 完整 BA"],
  ["Sim(3) / SE(3) / SO(3)", "相似变换群 / 特殊欧氏群 / 特殊正交群"],
  ["Huber", "Huber 鲁棒代价"],
  ["feature-based / direct method", "基于特征的方法 / 直接法"],
  ["sparse / semi-dense / dense", "稀疏 / 半稠密 / 稠密"],
  ["outlier / inlier", "外点 / 内点"],
  ["lifelong mapping", "长期建图"],
  ["ground truth", "真值"],
  ["RMSE / ATE", "均方根误差 / 绝对轨迹误差"],
];

// 将术语表格式化为提示词片段（首次出现附原文的规则在系统提示词里约束）
export function formatGlossary(custom = "") {
  const base = TERMS.map(([en, zh]) => `- ${en} → ${zh}`).join("\n");
  const extra = custom && custom.trim() ? `\n# 用户自定义术语\n${custom.trim()}` : "";
  return `${base}${extra}`;
}

// 构建系统提示词（核心翻译指令）
export function buildSystemPrompt(customGlossary = "") {
  return `你是一位专业的学术翻译助手，擅长计算机视觉 / 机器人 / SLAM 等领域的英文学术论文翻译，翻译严谨、术语规范、版式接近正式论文。

## 翻译总则
1. 忠实优先：逐段翻译，不增删、不过度意译，保留原文信息完整性与客观学术语气。
2. 术语统一：全文使用同一中文译名。术语基准如下（首次出现附英文原文，之后可只写中文）：
${formatGlossary(customGlossary)}
3. 结构完整保留：标题、作者与单位、摘要、索引词、各章节编号与标题（I./II.…）、子节层级、附录、参考文献、作者简介，均不得遗漏。
4. 公式零改写：所有 $...$（行内）与 $$...$$（独立）公式原样保留为 LaTeX，不翻译符号、不改写结构；仅翻译公式前后的说明文字。公式编号如 (1)、(5) 保留。
5. 表格：原样保留全部数值、单位与表头；表注翻译。表内英文缩写（RMSE、ms、cm、m）保留。请以 Markdown 表格输出。
6. 图/图表：保留图号（Fig. 1 → 图 1）与翻译后的图注。若原文为图像无法提取像素，用"见图 X"标注。
7. 参考文献：文献条目保持英文原文，便于检索；仅翻译正文中对文献的描述性文字。
8. 作者简介：翻译为通顺中文，姓名、学位、机构保留原文或音译，保持统一。

## 输出要求
- 仅返回翻译后的内容，不要添加任何解释、前言或"以下是翻译"之类的套话。
- 保留输入的结构标记（如 [H1]、[P]、[TABLE]、[FIG] 等），以便程序重组版式。
- 若输入内容为孤立公式、符号碎片、编号片段或无法理解的内容，请**原样返回该内容本身**，
  绝不输出"抱歉"、"请提供"、"内容不完整"等任何解释性文字。

${customGlossary && customGlossary.trim() ? "\n# 额外用户指令\n" + customGlossary.trim() : ""}`;
}

// 结构标记约定（抽取与渲染共用）
export const BLOCK = {
  H1: "[H1]",
  H2: "[H2]",
  H3: "[H3]",
  P: "[P]",
  TABLE: "[TABLE]",
  FIG: "[FIG]",
  EQUATION_NOTE: "[EQN]",
};
