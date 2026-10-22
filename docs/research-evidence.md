# 研究与交互设计依据

本记录区分论文观察、适用范围和产品决策。方法规则与UI的实际效果，需要在目标人群中预试。当前应用适用于探索性研究收集；正式量表应用需完成相应的信效度和测量等值性验证。

## 已精读的方法与交互文献

### Boateng 等，2018

[Best Practices for Developing and Validating Scales for Health, Social, and Behavioral Research: A Primer](https://pmc.ncbi.nlm.nih.gov/articles/PMC6004510/)，DOI 10.3389/fpubh.2018.00149。

阅读重点：领域定义、条目生成、内容效度、认知访谈、样本量、因子结构、计分、信度和效度章节。

- 文中区分三阶段九步骤。内容效度需要专业与目标人群判断，认知预试关注参与者如何理解和形成回答。
- 量表计分建立在合理的维度结构上；样本量取决于模型、条目、总体与资源。文中列出的经验样本量只提供规划参考。
- 产品落实：每个方案记录研究设计、分析单位、估计目标、样本量依据、偏差处理与验证计划。维度明确选择逐题描述或有依据的探索性均值。
- 后续验证：独立研究者审查内容，目标人群认知访谈，必要的EFA/CFA、信度、收敛/区分效度和跨组等值性检验。

### DeJonckheere 与 Vaughn，2019

[Semistructured interviewing in primary care research: a balance of relationship and rigour](https://pmc.ncbi.nlm.nih.gov/articles/PMC6910737/)，DOI 10.1136/fmch-2018-000057。

阅读范围：正文的设计与实施步骤、关系建立、访谈技巧、分析与可信性，以及讨论。

- 先说明目的、过程与时间，从容易回答的情境问题开始；尊重参与者视角，围绕具体表达追问。指南试访有助于把握节奏。
- 研究主要讨论人类面对面的质性访谈。用于文本AI访谈时，需要对关系体验和追问质量重新验证。
- 产品落实：简短开场、逐题呈现、明确的跳过与结束操作、可查看的回答记录、参与者控制的节奏确认。

### Cernat 等，2022

[The Impact of Survey Mode Design and Questionnaire Length on Measurement Quality](https://www.ssoar.info/ssoar/bitstream/document/91644/1/ssoar-smr-2022-OnlineFirst-cernat_et_al-The_Impact_of_Survey_Mode.pdf)，DOI 10.1177/00491241221140139。

精读数据收集实验、问卷设计、统计方法、等值性检验、结果与讨论。

- EVS德国实验比较约59分钟面访、55分钟混合模式长卷和38分钟混合模式矩阵短卷。抽样后随机分组，另有激励、调查时段和选择性参与等实际差异。
- 比较调查模式时，24个量表中21个达到度量等值、15个达到标量等值；比较长短问卷时分别为22个和19个。
- 产品落实：固定核心题的措辞、顺序、量尺与计分；动态追问作为单独的解释性材料。改变交互模式后的分数比较，需要等值性证据支持。
- 时长策略：根据方案与预试估计时长，作为节奏参考；不再通过固定时长或固定收尾窗口截断调查。

### Kim、Lee 与 Gweon，CHI 2019

[Comparing Data from Chatbot and Web Surveys: Effects of Platform and Conversational Style on Survey Response Quality](https://soominkim.github.io/project/CHI2019_KIM_Comparing.pdf)。

精读实验设计、被试、测量指标、结果、质性反馈与局限。

- 2×2实验比较网页/聊天与正式/随和语气。招募117名韩国青少年，106名完成并纳入分析；被试熟悉Facebook Messenger和网页调查。
- 对话平台和语气在回答区分度上有交互效果。该指标反映作答方式，其对其他人群、研究目的和真实回答质量的含义仍需验证。
- 论文包含用户对重复提问、回答更改和中断恢复的反馈；随和语气的偏好与青少年样本背景有关。
- 产品落实：语气配合研究人群，保持引导简短、具体；核心题固定，允许查看历史和恢复访谈。回答更改需要处理后续追问依赖，每题由参与者确认后保存，现已支持返回修改；其他预定答案保留，受影响的追问重新判断。

### Couper、Baker 与 Mechling，2011

[Placement and Design of Navigation Buttons in Web Surveys](https://www.surveypractice.org/article/3054-placement-and-design-of-navigation-buttons-in-web-surveys)。

精读实验条件、样本、结果表与讨论。

- 1898名合格成人开始调查，1720名完成。按钮布局对返回按钮的使用有影响，整体退出率与完成时间的差异证据较弱。
- 自愿在线面板样本可能熟悉调查。作者强调导航习惯及区分有意返回与误触。
- 产品落实：继续操作保持主按钮样式，跳过和结束使用较低视觉权重；键盘焦点、弹窗与下拉沿用项目Bits UI组件。布局选择继续以实际可用性验证为准。

## 补充的数据设计文献

以下文献补足变量用途、分析与数据精度的依据。它们没有提供适用于每个课题的人口统计学题目清单；项目采用的题目角色划分属于工程实现。

- [VanderWeele (2019), Principles of confounder selection](https://pmc.ncbi.nlm.nih.gov/articles/PMC6447501/)，DOI 10.1007/s10654-019-00494-6。阅读引言、协变量选择原则及统计选择方法讨论。协变量的取舍依赖领域与时间顺序知识；统计关联本身不能区分混杂、中介和碰撞变量。适用范围是因果效应调整，不能将其当作所有描述性问卷必须控制变量的依据。
- [Altman & Royston (2006), The cost of dichotomising continuous variables](https://pmc.ncbi.nlm.nih.gov/articles/PMC1458573/?pdf=1)，DOI 10.1136/bmj.332.7549.1080。阅读正文及结论。二分连续资料会损失信息，掩盖非线性，并可能留下残余混杂。原文也区分多类别与二分处理，结论不等于一律禁止分类回答。项目要求结合分析用途说明所需精度，区分采集精度与报告分组。
- [Artino et al. (2014), Developing questionnaires for educational research: AMEE Guide No. 87](https://pmc.ncbi.nlm.nih.gov/articles/PMC4059192/)，DOI 10.3109/0142159X.2014.889814。阅读研究问题与测量适配、构念定义、已有工具的适用性、目标人群访谈和条目开发章节。原文主要讨论医学教育中的自填问卷与量表，不覆盖全部调查设计；强调分数解释的效度取决于人群、情境和用途。

落实为通用方案：每题记录收集用途和可选的维度关联，同一变量可承担多个用途；计分依明确规则执行，资格条件另列。数量资料的分组与协变量调整需要分析依据。年龄通过相同机制处理，不设置专属规则或互斥的变量类别。

## 设计指南

[NN/g Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) 是设计指南。应用采用其信息分层原则：默认展示当前任务所需内容，编辑、方法和附加设置按需打开。

同时核对 AAPOR 调查最佳实践、Pew 问题措辞指南和 COSMIN 测量工具评价资源，链接见 [research.md](./research.md)。

跨领域复核、LLM访谈实验及尚未覆盖的设计见 [research-review.md](./research-review.md)。

## 当前证据边界与预试

Podsakoff 等（2003）的共同方法偏差综述目前核对了摘要与书目信息，尚未获取可精读的全文。应用将同源自报、团队内依赖和员工/管理者关系列为方案审查项，具体处理应由研究者结合可用数据来源和设计确认。

首轮目标人群预试应同时观察：

- 参与者对题意和选项的解释是否符合构念定义；
- 实际时长、停留与跳过发生在哪些题目，是否存在重复或费解的追问；
- 开场是否让参与者理解价值与用途，结束和撤回是否容易找到；
- 手机触控、键盘和屏幕阅读器能否完成作答；
- 与固定问卷相比，分布、缺失、回答深度及构念结构是否发生变化。

新研究由信息缺口、重复程度与参与意愿决定追问和收尾。模型调用等待期限仍是运行保护，超时次数导出用于复核。分析时结合实际回答和试访反馈解释交互数据。
