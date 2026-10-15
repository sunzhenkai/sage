import type { en } from './en';

/** English dictionary shape with leaf values widened to plain strings (zh-CN values are not literal types). */
type DictionaryShape<T> = { [K in keyof T]: T[K] extends string ? string : DictionaryShape<T[K]> };

/**
 * Simplified Chinese dictionary. Wording follows tasks/ongoing/agent-web-i18n/glossary.md;
 * keys are bound to the `en` source shape, so a missing or extra key fails `tsc`.
 * Inline values (`{name}`) are joined inside sentences — keep fragments free of leading full-width punctuation.
 */
export const zhCN = {
  /** Browser tab title, kept in sync by `lib/i18n.ts` (index.html ships the English default). */
  app: {
    title: 'Sage 智能体控制台'
  },
  common: {
    save: '保存',
    cancel: '取消',
    delete: '删除',
    create: '新建',
    search: '搜索',
    retry: '重试',
    pause: '暂停',
    resume: '恢复',
    refresh: '刷新',
    copy: '复制',
    copied: '已复制',
    untitledSession: '未命名对话'
  },
  nav: {
    /** Sidebar group headings (nav.ts stores the group keys, not the labels). */
    groups: {
      workspace: '工作区',
      agents: '智能体',
      configure: '配置'
    },
    overview: '概览',
    chat: '对话',
    tasks: '任务',
    schedules: '定时任务',
    apps: '应用',
    packages: '发布包',
    providers: '供应商',
    settings: '设置'
  },
  /** Status vocabulary rendered by more than one page (en keeps the raw enum wording). */
  status: {
    succeeded: '成功',
    completed: '已完成',
    failed: '失败',
    running: '运行中',
    paused: '已暂停',
    active: '活跃',
    available: '可用',
    alive: '存活',
    ready: '就绪',
    disabled: '已停用',
    stale: '已过期',
    unavailable: '不可用',
    promoted: '已提升',
    cancelled: '已取消',
    skipped: '已跳过',
    missed: '已错过',
    effectUnknown: '效果未知'
  },
  /** Relative-time units and suffix — composed by `lib/utils.ts` (`3m ago` / `3 分钟前`). */
  time: {
    secondsShort: '{count} 秒',
    minutesShort: '{count} 分钟',
    hoursShort: '{count} 小时',
    daysShort: '{count} 天',
    ago: '{value}前',
    later: '{value}后',
    justNow: '刚刚'
  },
  overview: {
    header: {
      runsFromSessions: '{runs} 次运行 · 来自 {sessions} 个会话'
    },
    range: {
      days: '{days} 天'
    },
    stats: {
      sessions: '会话',
      runSuccessRate: '运行成功率',
      activeTasks: '活跃任务',
      medianRunTime: '运行耗时中位数',
      lastDays: '最近 {days} 天',
      finishedRuns: '{done}/{total} 次运行',
      tasksTotal: '共 {count} 个',
      completedRuns: '已完成 {count} 次'
    },
    insights: {
      up: '上升',
      down: '下降',
      runs: {
        snapshot: '每日运行 · 最近 {range} 天',
        prompt: '为什么失败的运行会失败？',
        lead: '过去 {range} 天的运行成功率为',
        middle: '——失败数',
        tail: '与前半段相比。',
        finishedDelta: '占已完成 {pct}'
      },
      sessions: {
        snapshot: '每日会话 · 最近 {range} 天',
        prompt: '总结本周的会话',
        lead: '你发起了',
        middle: '个会话，相比前半段',
        tail: '运行耗时中位数为',
        end: '。'
      },
      schedules: {
        snapshot: '每日定时任务触发',
        prompt: '哪些定时任务不健康？',
        lead: '定时任务共触发',
        middle: '次；其中',
        tail: '次失败或错过，覆盖 {schedules} 个定时任务。'
      }
    },
    charts: {
      insights: '洞察',
      insightsEmpty: '有运行数据后即显示洞察',
      runsByStatus: '按状态分组的运行',
      runsByStatusDescription: '每日启动的对话运行',
      sessionsPerDay: '每日会话',
      successRate: '成功率',
      successRateDescription: '成功 ÷ 已结束的运行',
      runDuration: '运行耗时',
      runDurationMedian: '中位数 {seconds} 秒',
      runDurationFallback: '已完成的运行',
      latency: '延迟',
      latencyDescription: '每日运行耗时 · p50 / p95（秒）',
      tokensCost: 'Token 与成本',
      tokensCostMock: '根据运行量估算（mock）',
      tokensCostUnavailable: 'agent-api 尚未上报',
      tokensLegend: '千 tokens',
      tokensEmpty: 'API 未暴露 Token 用量',
      activity: '活跃度',
      activityDescription: '运行、会话与任务更新 · 最近 12 周',
      scheduleTriggers: '定时任务触发',
      scheduleTriggersNoToken: '需要服务令牌',
      scheduleTriggersCount: '触发 {count} 次，覆盖 {schedules} 个定时任务',
      scheduleTriggersEmptyNoToken: '在设置中添加服务令牌',
      scheduleTriggersEmpty: '该范围内没有触发',
      providerUsage: '供应商用量',
      providerUsageMock: '每个连接的运行数',
      providerUsageLive: '连接数（API 未暴露按运行归因）',
      providerUsageEmpty: '没有供应商',
      topApps: '热门应用 · 任务',
      inFlight: '进行中',
      inFlightDescription: '{inflight} 个运行中或等待 · 共 {total} 个任务',
      inFlightEmpty: '没有运行中的任务',
      tasksByStatus: '按状态分组的任务',
      tasksByStatusEmpty: '还没有任务',
      series: {
        succeeded: '成功',
        failed: '失败',
        active: '活跃',
        skipped: '跳过',
        missed: '错过',
        sessions: '会话',
        runs: '运行',
        successPct: '成功 %',
        failedOrMissed: '失败或错过'
      },
      durations: {
        under5: '<5 秒',
        to10: '5–10 秒',
        to20: '10–20 秒',
        to40: '20–40 秒',
        over40: '>40 秒'
      }
    },
    inFlight: {
      workflow: '工作流',
      updated: '更新时间'
    },
    recentSessions: {
      title: '最近会话'
    }
  },
  chat: {
    newSession: '新建会话',
    filterSessions: '筛选会话',
    empty: {
      archived: '没有已归档会话',
      none: '还没有会话',
      hint: '与运行智能体开始一段对话。'
    },
    noSelection: {
      title: '未选择会话',
      hint: '从列表中选择一个会话，或新建一个。'
    },
    commandMenu: '命令面板',
    header: {
      archivedBadge: '已归档',
      created: '创建于 {time}',
      run: '次运行',
      runs: '次运行'
    },
    tabs: {
      chatHint: '对话',
      runs: '运行',
      runsHint: '运行历史'
    },
    archive: '归档',
    unarchive: '取消归档',
    deleteSession: '删除会话',
    deleteConfirm: '永久删除这个会话？',
    sessionTitleAttr: '会话 {id}',
    runs: {
      empty: '还没有运行。',
      started: '开始时间',
      completed: '完成时间',
      attempt: '尝试次数',
      durationTitle: '运行耗时',
      durationDescription: '每次运行的秒数，按结果着色'
    },
    activity: {
      empty: '还没有动态。在下方写下第一条消息——每条消息都会启动一次运行，可实时跟踪。'
    },
    run: {
      started: '运行已开始',
      attempt: '第 {attempt} 次尝试',
      called: '已调用 {tool}',
      calling: '正在调用 {tool}',
      calledChip: '已调用',
      callingChip: '调用中',
      taskStatus: '任务 {status}',
      task: '任务',
      reason: '原因',
      writing: '正在撰写回答',
      waiting: '等待模型响应',
      failed: '运行失败',
      completed: '运行已完成',
      thinking: '思考中',
      failedAfter: '失败，用时 {took}',
      workedFor: '用时 {took}',
      generating: '生成中',
      toolCallsOne: '{tools} 次工具调用',
      toolCallsMany: '{tools} 次工具调用',
      artifactOne: '{artifacts} 个产物',
      artifactMany: '{artifacts} 个产物',
      toolCallsAndArtifacts: '{tools}，{artifacts}'
    },
    followUps: {
      summarize: '用 3 个要点总结一下',
      next: '接下来我该做什么？'
    },
    composer: {
      mockPlaceholder: 'Mock 模式为只读——无法发送',
      placeholder: '向运行智能体提问——@ 引用任务，/ 查看命令'
    },
    commands: {
      new: '开始新会话',
      archive: '归档这个会话',
      unarchive: '取消归档这个会话',
      retry: '重试上一次失败的运行',
      runs: '查看运行历史'
    },
    sources: {
      taskTypeFallback: '任务'
    },
    stream: {
      live: '已连接',
      connecting: '连接中',
      reconnecting: '重连中',
      closed: '离线'
    }
  },
  tasks: {
    tabs: {
      all: '全部任务',
      active: '进行中',
      done: '已完成',
      activity: '活动',
      runLogs: '运行日志',
      artifacts: '产物',
      raw: '原始数据'
    },
    empty: {
      title: '没有任务',
      hint: '当对话消息被提升为任务，或定时任务触发时，任务会出现在这里。'
    },
    health: {
      title: '健康度',
      description: '全部任务的状态分布与每日动态。',
      statusDistribution: '状态分布',
      totalTasks: '{count} 个任务',
      succeeded: '成功',
      updatesPerDay: '每日更新',
      updatesPerDayDescription: '最近 14 天，按当前状态'
    },
    inFlight: {
      title: '进行中',
      description: '运行中或等待中的任务，最新的在前。',
      workflow: '工作流',
      target: '目标',
      updated: '更新时间'
    },
    all: {
      title: '全部任务',
      description: '点击某一行可打开任务。'
    },
    columns: {
      task: '任务',
      status: '状态',
      type: '类型',
      target: '目标',
      attempt: '尝试次数',
      lastUpdate: '最后更新'
    },
    footer: '{inflight} 个进行中 · {failed} 个失败',
    detail: {
      cancelConfirm: '取消这个任务？',
      properties: '属性',
      status: '状态',
      type: '类型',
      attempt: '尝试次数',
      revision: '修订',
      lifecycle: '生命周期',
      execution: '执行',
      workflow: '工作流',
      target: '目标',
      freshness: '新鲜度',
      session: '会话',
      timestamps: '时间',
      updated: '更新时间',
      observed: '观测时间',
      taskFallback: '任务'
    },
    approval: {
      pausedEyebrow: '已暂停——等待你的决定',
      effectUnknownEyebrow: '效果未知——需要决策',
      pausedQuestion: '这个任务已暂停。接下来如何继续？',
      effectUnknownQuestion: '上一次副作用无法确认。智能体应如何继续？',
      resumeDescription: '发送恢复信号，并从检查点继续',
      cancelLabel: '取消任务',
      cancelDescription: '停止工作流，不再运行',
      retryLabel: '重试任务',
      retryDescription: '开始新的尝试（副作用可能发生两次）',
      cancelAndInvestigate: '就此停止并排查运行日志'
    },
    events: {
      empty: '还没有动态。',
      steps: '{count} 步',
      stepsOver: '{count} 步，用时 {span}',
      waiting: '等待下一步'
    },
    runLogs: {
      empty: '没有运行日志。只有持久化协调器（v2）任务才有运行日志。',
      eventsIn: '{attempt} 中的 {count} 个事件',
      more: '还有更多事件…'
    },
    artifacts: {
      empty: '没有产物。',
      download: '下载',
      select: '选择一个产物进行预览。'
    }
  },
  schedules: {
    new: '新建定时任务',
    dialog: {
      description: 'POST /v1/schedules——需要服务令牌。'
    },
    empty: {
      title: '没有定时任务',
      hint: '按 cron 或间隔运行智能体应用任务。需要服务令牌。'
    },
    trigger: {
      cron: 'cron {expression}（{timezone}）',
      every: '每 {minutes} 分钟'
    },
    activity: {
      title: '活动',
      description: '最近 14 天的触发结果，以及接下来会触发什么。',
      triggerHistory: '触发历史',
      occurrences: '{count} 次触发',
      nextRuns: '接下来的运行',
      minutesUntilNext: '距下次触发的分钟数',
      hoursMinutes: '{hours} 小时 {minutes} 分',
      minutes: '{minutes} 分钟'
    },
    sections: {
      active: '已启用',
      paused: '已暂停',
      activeDescription: '按触发器运行。',
      pausedDescription: '恢复前不会触发。'
    },
    row: {
      revision: '修订 {revision}',
      next: '下次 {time}'
    },
    form: {
      paramsError: 'params 必须是合法 JSON',
      scheduleId: '定时任务 ID',
      scheduleIdHint: '小写，[a-z0-9._-]，至少 3 个字符',
      displayName: '显示名称',
      releaseId: '发布 ID（绑定锚点）',
      releaseBinding: '发布绑定',
      contentDigest: '内容摘要',
      trigger: '触发器',
      cronExpression: 'Cron 表达式',
      timezone: '时区',
      every: '间隔（分钟，≥1）',
      overlapPolicy: '重叠策略',
      misfirePolicy: '错过策略',
      environment: '环境',
      budgetRunsLimit: '预算：运行次数上限',
      invocationTask: '调用任务',
      invocationTaskHint: '^[a-z][a-z0-9-]*$，例如 finance-brief',
      invocationParams: '调用参数（JSON）',
      tenantPrefix: 'tenantId：',
      tenantSuffix: '（在设置中修改）',
      submit: '创建定时任务'
    },
    detail: {
      rev: '修订 {revision}',
      deleteConfirm: '删除定时任务 {schedule}？',
      properties: '属性',
      state: '状态',
      trigger: '触发器',
      task: '任务',
      binding: '绑定',
      followLatest: '跟随最新版本',
      overlap: '重叠策略',
      misfire: '错过策略',
      constraints: '约束',
      envs: '环境',
      budget: '预算',
      timestamps: '时间',
      nextFire: '下次触发',
      created: '创建时间',
      updated: '更新时间',
      revision: '修订',
      workflow: '工作流',
      workflowDescription: '触发 → 护栏 → 任务。',
      triggerHistory: '触发历史',
      triggerHistoryDescription: '最近 30 次触发。',
      noTriggers: '还没有触发。',
      occurrence: '触发记录',
      error: '错误',
      detail: '详情',
      rawDefinition: '原始定义'
    },
    flow: {
      trigger: '触发器',
      policy: '策略',
      task: '运行任务',
      guardRails: '护栏',
      pausedNoFire: '已暂停——不会触发',
      nextFire: '下次触发 {time}',
      pinned: '固定 {release}',
      followsLatest: '跟随最新发布',
      overlap: '重叠',
      misfire: '错过'
    }
  },
  apps: {
    empty: {
      title: '没有应用',
      hint: '通过 agent-api 注册智能体包（pnpm --filter @sage/agent-api register-package）。'
    },
    all: {
      title: '全部应用',
      description: '已注册的智能体应用。点击某一行可查看发布、任务与资产。'
    },
    columns: {
      app: '应用',
      status: '状态',
      latestVersion: '最新版本',
      runs: '运行 · 14 天',
      releases: '发布',
      created: '创建时间',
      lastUpdate: '最后更新'
    },
    detail: {
      deleteConfirm: '删除应用 {app}？',
      properties: '属性',
      status: '状态',
      version: '版本',
      entry: '入口',
      model: '模型',
      created: '创建时间',
      skills: '技能',
      capabilities: '能力',
      descriptionFallback: '智能体应用清单、任务、输入与打包资产。',
      tasks: '任务',
      inputs: '输入与数据源',
      input: '输入',
      source: '数据源',
      required: '必填',
      optional: '可选',
      assets: '资产',
      rawManifest: '原始清单'
    }
  },
  packages: {
    empty: {
      title: '没有发布包'
    },
    all: {
      title: '全部发布包',
      description: '已发布的智能体包及其最新内容摘要。'
    },
    columns: {
      package: '发布包',
      latestVersion: '最新版本',
      installs: '安装 · 14 天',
      releases: '发布',
      contentDigest: '内容摘要',
      lastUpdate: '最后更新'
    },
    detail: {
      description: '发布包注册记录与发布。'
    }
  },
  providers: {
    description: '运行智能体使用的模型供应商连接。可从 models.dev 目录中选择，或输入自定义端点；API 密钥在服务端加密保存，永不返回。',
    addConnection: '添加连接',
    dialog: {
      title: '添加供应商连接',
      description: '从 models.dev 快照自动填充——基础 URL 与模型仍可编辑。API 密钥在服务端加密保存，永不返回。'
    },
    connections: {
      title: '连接',
      configured: '已配置 {count} 个',
      empty: '没有连接',
      emptyHint: '添加一个连接，让智能体可以调用模型。',
      default: '默认',
      env: '环境变量',
      makeDefault: '设为默认',
      deleteConfirm: '删除 {name}？'
    },
    usage: {
      title: '用量',
      descriptionMock: '每个供应商连接的请求与错误 · 最近 14 天（mock）。',
      descriptionLive: 'agent-api 尚未暴露按供应商的请求指标。',
      empty: '没有可用的用量指标。',
      chartTitle: '按供应商的请求',
      chartDescription: '{requests} 次请求 · {errors} 个错误',
      requests: '请求',
      errors: '错误'
    },
    runAgent: {
      title: '运行智能体',
      description: '对话消息未指定连接时使用的默认连接。',
      defaultConnection: '默认连接',
      updatedBy: '{time} 由 {user} 更新',
      unset: '未设置'
    },
    catalog: {
      title: '模型目录',
      description: '用于供应商与模型元数据的 models.dev 快照。',
      availability: '可用性',
      providersModels: '供应商 / 模型',
      lastSync: '上次同步',
      nextSync: '下次同步'
    },
    create: {
      fromCatalog: '来自 models.dev',
      manual: '手动',
      catalogWarning: '目录快照状态为 {availability}（上次同步 {time}）——供应商搜索可能为空。手动模式始终可用。',
      provider: '供应商',
      providerCount: 'models.dev 快照中的 {count} 个供应商',
      model: '模型',
      modelHint: '从快照中选择模型，或输入模型 ID 后选择“使用 …”。',
      modelSelected: '已选择：{model}',
      searchProviders: '搜索供应商…',
      noProvidersMatch: '没有匹配的供应商',
      shown: '已显示 {count} 个',
      typeToNarrow: '输入以缩小范围',
      pickProviderFirst: '请先选择供应商',
      searchModels: '搜索模型…',
      noModelsMatch: '没有匹配的模型',
      showingFirst60: '仅显示前 60 个——输入以缩小范围',
      noEndpoint: '无端点',
      useCustom: '使用“{model}”',
      customModelId: '自定义模型 ID',
      baseUrl: '基础 URL',
      invalidUrl: '必须是公开的 HTTPS URL。',
      useCatalogDefault: '使用目录默认值',
      noCatalogEndpoint: 'models.dev 没有这个供应商的端点——请手动填写（代理或网关均可）',
      publicHttpsHint: '公开的 HTTPS 端点——代理或网关可覆盖',
      anthropicHint: 'Anthropic 调用会归一化结尾的 /v1',
      adapter: '适配器',
      modelId: '模型 ID',
      name: '名称',
      namePlaceholder: '显示在连接列表中',
      apiKey: 'API 密钥',
      testing: '测试中…',
      test: '测试连接'
    },
    baseUrlSource: {
      model: 'models.dev 模型端点',
      provider: 'models.dev 供应商端点',
      known: '已知默认端点（非 models.dev）'
    }
  },
  settings: {
    searchPlaceholder: '搜索{title}',
    resetToDefaults: '恢复默认值',
    pages: {
      appearance: { title: '外观', description: '控制台在此浏览器中的外观。' },
      shortcuts: { title: '快捷键', description: '无需离开键盘即可浏览控制台。' },
      general: { title: '连接', description: '控制台如何访问 agent-api。仅存储在 localStorage 中。' },
      status: { title: '状态', description: '对 agent-api 的实时探测。' },
      developer: { title: '开发者', description: '界面开发与截图工具。' }
    },
    groups: {
      preferences: '偏好',
      system: '系统'
    },
    nav: {
      appearance: '外观',
      shortcuts: '快捷键',
      connection: '连接',
      status: '状态',
      developer: '开发者'
    },
    appearance: {
      card: '主题',
      title: '颜色主题',
      description: '跟随系统将使用操作系统的偏好设置。',
      language: '语言',
      languageDescription: '跟随浏览器语言；无匹配时默认英文。',
      languageAuto: '自动',
      languageEnglish: 'English',
      languageChinese: '中文',
      light: '浅色',
      dark: '深色',
      system: '跟随系统'
    },
    shortcuts: {
      general: '通用',
      navigation: '导航',
      notSet: '未设置',
      reset: '恢复默认',
      resetAria: '恢复 {label}',
      clear: '清除快捷键',
      clearAria: '清除 {label}'
    },
    shell: {
      searchAria: '搜索设置',
      empty: '没有匹配的设置：“{query}”。'
    },
    general: {
      apiBaseUrl: { title: 'API 基础 URL', description: '留空 = 同源；开发服务器将 /v1 代理到 :9610。', placeholder: '同源' },
      serviceToken: { title: '服务令牌', description: '以 Authorization: Bearer 发送。定时任务需要。', placeholder: '未设置' },
      tenantId: { title: '租户 ID', description: '必须与 agent-api 的 SAGE_TENANT_ID 一致。' },
      saved: '已保存',
      save: '保存更改'
    },
    status: {
      card: '探测',
      liveness: '存活检查',
      readiness: '就绪检查',
      unreachable: '无法访问'
    },
    developer: {
      card: '数据',
      mockData: 'Mock 数据',
      mockDescription: '只读演示数据集。也可用 ?mock=1 / ?mock=0 切换。'
    }
  },
  notFound: {
    header: '未找到',
    title: '页面不存在',
    descriptionLead: '该路径下没有内容：',
    descriptionTail: '。',
    back: '返回概览'
  },
  /** Shared component chrome: ui primitives, shell, bui blocks and chart defaults. */
  ui: {
    loading: '加载中',
    error: {
      requestFailed: '请求失败。',
      tokenRequired: '需要服务令牌。',
      addToken: '添加令牌'
    },
    combobox: {
      placeholder: '搜索…',
      empty: '没有匹配项',
      loading: '加载中…'
    }
  },
  appShell: {
    search: '搜索（⌘K）',
    collapseSidebar: '折叠侧边栏（⌘B）',
    expandSidebar: '展开侧边栏（⌘B）',
    mockTitle: '演示数据——点击退出 mock 模式',
    mockLabel: 'Mock 数据 · 只读',
    mockExit: '退出',
    sameOrigin: '同源',
    online: '在线',
    offline: '离线',
    toggleTheme: '切换主题'
  },
  commandPalette: {
    title: '命令面板',
    description: '导航并运行命令',
    placeholder: '输入命令或搜索…',
    empty: '没有结果。',
    goTo: '前往{page}',
    groups: {
      navigation: '导航',
      actions: '操作',
      recentSessions: '最近会话'
    },
    newChat: '新建会话',
    theme: '主题：{theme}'
  },
  /** Keyboard-shortcut vocabulary — `lib/shortcuts.ts` stores these keys (single source of truth). */
  shortcuts: {
    palette: { label: '命令面板', description: '搜索页面、会话与操作' },
    sidebar: { label: '切换侧边栏', description: '折叠或展开主侧边栏' },
    'go-overview': { label: '前往概览', description: '图表与最近动态' },
    'go-chat': { label: '前往对话', description: '与运行智能体的对话' },
    'go-tasks': { label: '前往任务', description: '全部任务及其状态' },
    'go-schedules': { label: '前往定时任务', description: '周期性触发' },
    'go-apps': { label: '前往应用', description: '已注册的智能体应用' },
    'go-packages': { label: '前往发布包', description: '已发布的智能体包' },
    'go-providers': { label: '前往供应商', description: '模型供应商连接' },
    'go-settings': { label: '前往设置', description: '当前页面' },
    send: { label: '发送消息', description: '在对话输入框中' }
  },
  sessionList: {
    noRuns: '无运行',
    buckets: {
      today: '今天',
      yesterday: '昨天',
      earlier: '更早'
    },
    agentPrefix: '智能体：',
    youPrefix: '你：',
    runOne: '次运行',
    runMany: '次运行',
    messages: '条消息',
    recentRuns: '最近运行',
    sessionTitle: '会话标题',
    sessionView: '会话视图',
    filterArchived: '已归档',
    filterActive: '活跃'
  },
  promptBar: {
    placeholder: '随便问点什么——@ 引用，/ 查看命令',
    promptAria: '输入提示词',
    reference: '引用（@）',
    providerConnection: '供应商连接',
    serverDefault: '服务端默认',
    send: '发送',
    sendTitle: '发送（Enter）',
    noMatches: '没有匹配项',
    footerSources: '输入以搜索任务、应用与定时任务',
    footerCommands: '命令在本控制台本地执行'
  },
  recordsTable: {
    count: '项'
  },
  taskRows: {
    details: '详情'
  },
  thinking: {
    active: '思考中'
  },
  loadingState: {
    working: '处理中'
  },
  codeBlock: {
    copyAria: '复制代码'
  },
  insightCards: {
    title: '洞察',
    trendSnapshot: '趋势快照',
    previous: '上一张洞察',
    next: '下一张洞察',
    points: '{count} 个点'
  },
  approvalCard: {
    confirm: '继续',
    notNow: '暂不',
    working: '处理中…'
  },
  charts: {
    noData: '该范围内没有数据',
    heatmap: '活跃度热力图'
  }
} satisfies DictionaryShape<typeof en>;
