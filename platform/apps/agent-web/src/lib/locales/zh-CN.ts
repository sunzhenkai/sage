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
    pending: '等待中',
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
      scheduleTriggersCount: '触发 {count} 次，覆盖 {schedules} 个定时任务',
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
      properties: '属性',
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
      description: '按 cron 或间隔运行智能体应用任务。'
    },
    empty: {
      title: '没有定时任务',
      hint: '按 cron 或间隔运行智能体应用任务。'
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
      app: '应用',
      selectApp: '选择应用',
      release: 'Release',
      selectRelease: '选择 Release',
      releaseHint: 'FIXED 固定该 Release；FOLLOW 在触发时运行最新版本，并以当前最新 Release 作为锚点。',
      binding: '版本绑定',
      followLatest: '跟随最新 Release',
      noReleases: '该应用还没有 Release，请先发布一个。',
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
    new: {
      action: '新建应用',
      title: '新建应用',
      description: '先创建可变的应用，源文件保存在草稿中；发布后才会产生不可变的 Release。',
      appId: '应用 ID',
      appIdHint: '小写，[a-z0-9._-]，至少 3 个字符',
      name: '名称',
      nameHint: '可选，默认与应用 ID 相同',
      descriptionLabel: '描述',
      submit: '创建应用',
      creating: '正在创建…'
    },
    import: {
      action: '导入示例应用',
      title: '导入示例应用',
      description: '仓库内置的示例源包。同名应用不会被覆盖。',
      choose: '示例',
      loading: '正在读取示例…',
      importing: '正在导入…',
      success: '已导入 {app}，{files} 个源文件已进入应用。',
      exists: '{app} 已存在，未做任何修改。',
      failed: '导入失败。',
      view: '查看应用',
      done: '完成',
      retry: '重试',
      existsHidden: '服务端已有同 ID 应用但当前列表未显示（例如该应用已被删除）。示例导入只在全新创建应用时可用，请换一个示例。',
      existsBadge: '已导入'
    },
    empty: {
      title: '没有应用',
      hint: '新建一个空应用并编辑草稿，或从内置示例开始。'
    },
    noSelection: {
      title: '选择一个应用',
      hint: '从左侧列表点开，或新建一个。'
    },
    filterApps: '筛选应用',
    filterEmpty: {
      title: '没有匹配的应用',
      hint: '换个关键词，或清空筛选。'
    },
    menu: { more: '更多' },
    all: {
      title: '全部应用',
      description: '可变的智能体应用。点击某一行可编辑草稿、发布 Release 并查看运行。'
    },
    columns: {
      app: '应用',
      status: '状态',
      latestVersion: '最新版本',
      versionMeta: 'v{version} · {count}',
      runs: '运行 · 14 天',
      releases: '发布',
      draft: '草稿',
      unpublished: '未发布',
      created: '创建时间',
      lastUpdate: '最后更新'
    },
    examples: {
      finance: {
        name: '财经简报',
        description: '获取外汇汇率与全球主要股指快照，生成结构化财经简报。'
      },
      github: {
        name: 'GitHub 热门项目',
        description: '读取 GitHub trending 快照，产出排名解读、亮点与趋势摘要。'
      },
      lifecycle: {
        name: '生命周期探针',
        description: '最小示例包，无输入与参考资料，适合验证创建 → 发布 → 运行链路。'
      }
    },
    draft: {
      title: '草稿',
      description: '编辑源文件并保存修订；发布后生成不可变的 Release。',
      revision: 'r{revision}',
      files: '{count} 个文件',
      version: '版本',
      digest: '摘要',
      noFiles: '草稿还没有源文件。上传压缩包即可开始。',
      unsaved: '有未保存的修改',
      unpublished: '有未发布的修改',
      clean: '与最新 Release 一致',
      statusLine: '{revision} · {files} · {state}',
      stateCleanVersion: '与 v{version} 一致',
      save: '保存草稿',
      saving: '正在保存…',
      saved: '已保存为 r{revision}。',
      reload: '重新加载草稿',
      upload: '上传压缩包',
      uploading: '正在上传…',
      uploadDone: '草稿已由压缩包替换（r{revision}）。',
      uploadUnsupported: 'Mock 模式不支持压缩包上传。',
      download: '下载草稿',
      downloadFailed: '草稿下载失败。',
      publish: '发布 Release',
      publishing: '正在发布…',
      published: '已发布 v{version}。',
      existing: 'v{version} 已存在且内容相同，未生成新的 Release。',
      empty: '草稿为空——请先添加文件再发布。',
      conflict: '草稿已在别处更新（当前为 r{revision}）。本地修改已保留；重新加载将丢弃这些修改。',
      versionConflict: 'v{version} 已存在且内容不同。请先在 app.yaml 中提升版本号再发布。',
      saveFirst: '请先保存草稿再发布。',
      selectFile: '选择一个源文件进行编辑。'
    },
    release: {
      description: '不可变的应用快照与构建来源。',
      manifest: '清单',
      assets: '资产',
      assetsEmpty: '该 Release 没有资产。',
      provenance: '构建来源',
      showProvenance: '显示全部来源',
      downloadSource: '下载源码',
      downloadBundle: '下载打包产物',
      downloading: '正在准备…',
      downloadFailed: 'Release 下载失败。',
      raw: 'Release 原始详情',
      showRaw: '显示原始 JSON',
      run: '运行',
      fields: {
        version: '版本',
        releaseRef: 'Release 引用',
        releaseId: 'Release ID',
        contentDigest: '内容摘要',
        sourceFilesDigest: '源文件摘要',
        lockDigest: '锁定摘要',
        compilerBuild: '编译器构建',
        createdAt: '创建时间'
      }
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
      rawManifest: '原始清单',
      releases: '发布版本',
      openRelease: 'Release',
      run: '运行',
      runs: '运行历史',
      runsEmpty: '还没有运行记录。可从任一发布版本发起运行。',
      releasesEmpty: '还没有发布版本。编辑草稿后可以发布。',
      definitionEmpty: '这个应用没有任务、输入或数据源。',
      showManifest: '显示原始清单',
      tabs: {
        properties: '属性',
        draft: '草稿',
        releases: '发布',
        runs: '运行'
      },
      unknownVersion: '未知版本',
      sourceManual: '手动',
      sourceSchedule: '定时'
    },
    run: {
      title: '运行 {app}',
      description: '从发布版本 v{version} 发起一次新运行。参数来自清单 inputs。',
      task: '任务',
      required: '{name} 为必填',
      number: '{name} 必须是数字',
      numberHint: '以数字提交',
      enumEmpty: '—',
      dataSources: '数据源',
      dataSourcesHint: '清单中的只读声明，由运行时解析；此表单不会提交它们。',
      providerMissing: '没有启用且已保存凭据的供应商连接匹配该清单。请添加一个连接，并将其设为运行智能体的默认连接。',
      openProviders: '打开供应商配置',
      mockDisabled: 'Mock 模式为只读——请连接 agent-api 后再试运行。',
      submit: '开始运行',
      starting: '正在启动…'
    },
    runDetail: {
      properties: '属性',
      status: '状态',
      version: '版本',
      source: '来源',
      task: '任务',
      created: '创建时间',
      updated: '更新时间',
      release: '发布版本',
      releaseId: 'Release ID',
      freshness: '新鲜度',
      failureCode: '失败码',
      description: '应用运行详情、日志与产物。',
      updatedAgo: '更新于 {time}',
      openTask: '打开任务',
      overview: '概览',
      statusHint: '状态来自任务投影；等待中表示尚未观察到投影。',
      pendingHint: '运行已准入，正在等待第一次任务投影。任务启动后即可查看日志与产物。',
      runningHint: '运行还在进行，日志会跟着更新。',
      finishedHint: '这次运行已结束。日志和产物在上面的页签里。',
      tabs: {
        overview: '概览',
        logs: '运行日志',
        artifacts: '产物'
      }
    }
  },
  providers: {
    description: '运行智能体使用的模型供应商连接。可从 models.dev 目录中选择，或输入自定义端点；API 密钥在服务端加密保存，永不返回。',
    addConnection: '添加连接',
    dialog: {
      title: '添加供应商连接',
      description: '从 models.dev 快照自动填充——基础 URL 与模型仍可编辑。API 密钥在服务端加密保存，永不返回。',
      editTitle: '编辑供应商连接',
      editDescription: '可改模型、端点与名称。留空 API 密钥则保留已保存的凭据。'
    },
    connections: {
      title: '连接',
      configured: '已配置 {count} 个',
      empty: '没有连接',
      emptyHint: '添加一个连接，让智能体可以调用模型。',
      default: '默认',
      env: '环境变量',
      edit: '编辑',
      makeDefault: '设为默认',
      deleteConfirm: '删除 {name}？',
      moreModels: '另 {count} 个'
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
      modelId: '默认模型',
      modelIdHint: '也可直接填写模型 ID；目录选择会同步到这里。',
      models: '模型列表',
      modelsHint: '聊天时可为该连接选择的模型；未选择时使用默认模型。',
      modelsCount: '{count} 个模型',
      addModel: '添加模型…',
      addModelCatalogHint: '候选来自该供应商的 models.dev 快照；也可填写任意模型 ID。',
      addModelNoSuggestions: '输入模型 ID 后选择「使用 …」。',
      modelsLimit: '每个连接最多 {max} 个模型。',
      defaultBadge: '默认',
      makeDefaultModel: '设为默认',
      removeModel: '移除 {model}',
      name: '名称',
      namePlaceholder: '显示在连接列表中',
      apiKey: 'API 密钥',
      apiKeyKeep: '留空则保留已保存的密钥。',
      apiKeyPlaceholder: '••••••••（保持不变）',
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
      mcp: { title: 'MCP', description: '让外部 MCP 客户端（如 Claude Code）操作 Sage。' },
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
      mcp: 'MCP',
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
      tenantId: { title: '租户 ID', description: '必须与 agent-api 的 SAGE_TENANT_ID 一致。' },
      saved: '已保存',
      save: '保存更改'
    },
    mcp: {
      card: 'MCP server',
      endpoint: { title: '接入地址', description: '供 MCP 客户端连接的 Streamable HTTP 地址，随「连接」页的 API 基础地址推导。' },
      apiKey: {
        title: 'API Key',
        description: '仅用于外部 MCP 客户端，以 Authorization: Bearer 发送。填与 SAGE_SERVICE_TOKEN_HASHES 对应的同一把 key。',
        placeholder: '未设置',
        reveal: '显示 key',
        hide: '隐藏 key'
      },
      command: { title: '接入命令', description: '在 Claude Code 或任意 MCP 客户端中注册 Sage。' },
      test: {
        title: '测试连接',
        description: '用上方 API key 对接入地址执行 initialize + tools/list。',
        button: '测试连接',
        running: '测试中…',
        ok: '已连接：{server}，{count} 个工具',
        unreachable: '无法访问 {url}',
        failed: '连接失败：{status} {code}',
        mock: 'Mock 模式为只读演示，不测试真实连接。'
      }
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
      requestFailed: '请求失败。'
    },
    combobox: {
      placeholder: '搜索…',
      empty: '没有匹配项',
      loading: '加载中…'
    }
  },
  /**
   * 服务端错误码 → 界面文案，由 `lib/error-message.ts` 渲染（不会直接显示为键名）。
   * 普通键为 agent-api `sendError` 的精确 code；`_后缀` 键为透传 code 族（`SOURCE_*`、`PACKAGE_LOCK_*` 等），
   * 按最长前缀匹配。清单见 `lib/error-codes.ts`；未登记的 code 回退显示服务端原始英文消息。
   */
  errors: {
    // apps-api.ts
    APP_ALREADY_EXISTS: '同 ID 的应用已存在。',
    APP_AUTHENTICATION_REQUIRED: '应用 API 需要身份认证。',
    APP_DELETED: '应用已被删除。',
    APP_DRAFT_CONFLICT: '草稿已在别处更新，请重新加载或保留本地修改。',
    APP_DRAFT_EMPTY: '草稿为空，请先添加源文件再发布。',
    APP_DRAFT_INVALID: '草稿源文件校验失败。',
    APP_INVALID: '应用请求无效。',
    APP_NOT_FOUND: '应用不存在。',
    APP_OPERATION_REJECTED: '应用操作被拒绝。',
    APP_PACKAGE_ID_MISMATCH: '上传的包与该应用不匹配。',
    APP_UNAVAILABLE: '应用 API 暂时不可用。',
    APP_UPLOAD_UNTRUSTED_FIELD: '包含不被信任的字段，已拒绝。',
    RELEASE_VERSION_CONFLICT: '该版本已存在且内容不同。',
    // runs-api.ts
    INPUT_REMOVED: '自由输入已移除：请提交清单声明的参数（见 manifest inputs），或从对话中提升任务。',
    PACKAGE_RUN_UNTRUSTED_FIELD: '包含不被信任的字段，已拒绝。',
    PACKAGE_RUN_ADMISSION_NOT_AVAILABLE: '当前部署模式不支持发布包运行准入。',
    PACKAGE_RUN_AUTHENTICATION_REQUIRED: '发布包运行 API 需要身份认证。',
    IDEMPOTENCY_KEY_INVALID: 'Idempotency-Key 必须是 1-255 个字符的单个字符串。',
    RELEASE_NOT_FOUND: '发布版本不存在。',
    PACKAGE_RUN_MANIFEST_MISSING: '该发布版本没有清单摘要。',
    PROVIDER_DEPENDENCY_MISSING: '缺少必需的供应商依赖。',
    PACKAGE_RUN_ENTRY_MISSING: '该发布版本没有入口提示词内容。',
    PACKAGE_PARAMS_INVALID: '发布包参数不合法。',
    PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: '发布包快照来源不可用。',
    PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT: '发布包运行幂等冲突。',
    ADMISSION_SPEC_COMMIT_FAILED: 'Spec 提交失败。',
    PACKAGE_RUN_REJECTED: '发布包运行被拒绝。',
    PACKAGE_RUN_UNAVAILABLE: '发布包运行暂时不可用。',
    // schedules-api.ts
    SCHEDULE_RULE_INVALID: '定时任务定义不合法。',
    SCHEDULE_FORBIDDEN: '定时任务租户不匹配。',
    SCHEDULE_VALIDATION_FAILED: '定时任务绑定校验未通过。',
    SCHEDULE_ALREADY_EXISTS: '定时任务已存在。',
    SCHEDULE_NOT_FOUND: '定时任务不存在。',
    SCHEDULE_REVISION_CONFLICT: '定时任务版本冲突。',
    SCHEDULE_STORE_UNAVAILABLE: '定时任务存储不可用。',
    // catalog-api.ts
    CATALOG_INVALID_REQUEST: '供应商目录请求不合法。',
    CATALOG_SYNC_ATTEMPT_NOT_FOUND: '供应商目录同步记录不存在。',
    CATALOG_UNAVAILABLE: '供应商目录暂时不可用。',
    CATALOG_AUTHENTICATION_REQUIRED: '供应商目录需要身份认证。',
    CATALOG_SYNC_FORBIDDEN: '没有权限同步供应商目录。',
    CATALOG_PROJECTION_UNAVAILABLE: '供应商目录视图不可用。',
    CATALOG_CURSOR_SNAPSHOT_CHANGED: '翻页期间供应商目录已变化，请从第一页重新开始。',
    CATALOG_SYNC_RATE_LIMITED: '供应商目录同步过于频繁，请稍后重试。',
    CATALOG_SHUTTING_DOWN: '供应商目录正在关闭。',
    // provider-connections-api.ts
    PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED: '供应商连接 API 需要身份认证。',
    PROVIDER_CONNECTIONS_UNAVAILABLE: '供应商连接存储不可用。',
    PROVIDER_CONNECTION_UNTRUSTED_FIELD: '包含不被信任的字段，已拒绝。',
    PROVIDER_CONNECTION_INVALID_REQUEST: '供应商连接请求不合法。',
    SECRET_BACKEND_UNAVAILABLE: '密钥后端不可用。',
    PROVIDER_CONNECTION_NOT_FOUND: '供应商连接不存在。',
    PROVIDER_CONNECTION_PROTECTED: '部署环境变量提供的连接由可信引导维护，不能在此修改或删除。',
    PROVIDER_CONNECTION_IN_USE: '该供应商连接正被运行智能体设置引用，请先解除引用再删除。',
    // run-agent-settings-api.ts
    RUN_AGENT_SETTINGS_AUTHENTICATION_REQUIRED: '运行智能体设置 API 需要身份认证。',
    RUN_AGENT_SETTINGS_UNAVAILABLE: '运行智能体设置存储不可用。',
    RUN_AGENT_SETTINGS_UNTRUSTED_FIELD: '包含不被信任的字段，已拒绝。',
    RUN_AGENT_SETTINGS_INVALID_PROVIDER: '请选择已启用且已保存凭据的供应商连接。',
    // effect-resolutions-api.ts
    EFFECT_RESOLUTION_INVALID: '效果决议请求不合法。',
    // chat kernel (chat-compatibility.ts)
    HARNESS_FAILURE: '智能体运行失败。',
    CANCELLED: '智能体运行已取消。',
    // 透传 code 族 —— 按最长前缀匹配（见 lib/error-codes.ts）
    _SOURCE_ARCHIVE: '发布包源码归档不合法。',
    _SOURCE: '发布包源码校验未通过。',
    _PACKAGE_LOCK: '依赖锁校验未通过。',
    _PACKAGE_OUTPUT: '发布包产物校验未通过。',
    _PACKAGE: '发布包校验未通过。',
    _KERNEL: '运行内核拒绝了该操作。',
    _CAPABILITY: '能力校验未通过。',
    _CHECKPOINT: '检查点操作失败。',
    _LEDGER: '效果账本拒绝了该操作。',
    _EVENT: '运行事件流冲突。',
    _ENVELOPE: '运行信封不合法。',
    _SPEC: '运行 Spec 不可用或不合法。',
    _REPLAY: '重放校验失败。',
    _RETRY: '重试预算已耗尽。',
    _EFFECT: '效果结果未知或冲突。',
    _USAGE: '用量账本拒绝了该操作。',
    _IDENTITY: '身份校验失败。',
    _MIGRATION: '迁移失败。',
    _ADMISSION: '运行准入校验未通过。',
    _CANDIDATE: '候选不合法。',
    _ENGINE: '引擎绑定不合法。',
    _COMMAND: '命令与当前状态冲突。',
    _TARGET: '效果目标不可用。',
    _CHAIN: '效果链缺失或冲突。',
    _RECEIPT: '回执不可用。',
    _OBSERVATION: '观测不稳定。',
    _RELEASE: '发布仓库操作失败。',
    _API: '发布仓库接口调用失败。'
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
    'go-apps': { label: '前往应用', description: '智能体应用、草稿与 Release' },
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
    model: '模型',
    defaultModel: '默认',
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
