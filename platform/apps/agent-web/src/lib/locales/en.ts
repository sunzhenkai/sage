/**
 * English source dictionary — values are the exact strings the UI renders today (never rewritten here).
 * Every other locale must stay key-aligned with this object; `locales.test.ts` enforces that.
 * Keys are dotted paths (`nav.overview` → `t('nav.overview')`) organized as nested namespaces:
 * `common.*` is shared across pages, the rest follows the page/structure that renders it.
 */
export const en = {
  /** Browser tab title, kept in sync by `lib/i18n.ts` (index.html ships the English default). */
  app: {
    title: 'Sage Agent Console'
  },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    create: 'Create',
    search: 'Search',
    retry: 'Retry',
    pause: 'Pause',
    resume: 'Resume',
    refresh: 'Refresh',
    copy: 'Copy',
    copied: 'Copied',
    untitledSession: 'Untitled session'
  },
  nav: {
    /** Sidebar group headings (nav.ts stores the group keys, not the labels). */
    groups: {
      workspace: 'Workspace',
      agents: 'Agents',
      configure: 'Configure'
    },
    overview: 'Overview',
    chat: 'Chat',
    tasks: 'Tasks',
    schedules: 'Schedules',
    apps: 'Apps',
    packages: 'Packages',
    providers: 'Providers',
    settings: 'Settings'
  },
  /** Status vocabulary rendered by more than one page (en keeps the raw enum wording). */
  status: {
    succeeded: 'Succeeded',
    completed: 'Completed',
    failed: 'Failed',
    running: 'Running',
    paused: 'Paused',
    active: 'Active',
    available: 'Available',
    alive: 'Alive',
    ready: 'Ready',
    disabled: 'Disabled',
    stale: 'Stale',
    unavailable: 'Unavailable',
    promoted: 'Promoted',
    cancelled: 'Cancelled',
    skipped: 'Skipped',
    missed: 'Missed',
    pending: 'Pending',
    effectUnknown: 'Effect unknown'
  },
  /** Relative-time units and suffix — composed by `lib/utils.ts` (`3m ago` / `3 分钟前`). */
  time: {
    secondsShort: '{count}s',
    minutesShort: '{count}m',
    hoursShort: '{count}h',
    daysShort: '{count}d',
    ago: '{value} ago',
    later: '{value} later',
    justNow: 'just now'
  },
  overview: {
    header: {
      runsFromSessions: '{runs} runs from {sessions} sessions'
    },
    range: {
      days: '{days}d'
    },
    stats: {
      sessions: 'Sessions',
      runSuccessRate: 'Run success rate',
      activeTasks: 'Active tasks',
      medianRunTime: 'Median run time',
      lastDays: 'last {days}d',
      finishedRuns: '{done}/{total} runs',
      tasksTotal: '{count} total',
      completedRuns: '{count} completed'
    },
    insights: {
      up: 'up',
      down: 'down',
      runs: {
        snapshot: 'Runs per day · last {range}d',
        prompt: 'Why did the failed runs fail?',
        lead: 'Run success over the last {range} days is',
        middle: '— failures are',
        tail: 'versus the first half of the range.',
        finishedDelta: '{pct} of finished'
      },
      sessions: {
        snapshot: 'Sessions per day · last {range}d',
        prompt: 'Summarize this week’s sessions',
        lead: 'You started',
        middle: 'sessions,',
        tail: 'in the recent half; median run takes',
        end: '.'
      },
      schedules: {
        snapshot: 'Schedule triggers per day',
        prompt: 'Which schedules are unhealthy?',
        lead: 'Schedules fired',
        middle: 'times;',
        tail: 'failed or were missed across {schedules} schedules.'
      }
    },
    charts: {
      insights: 'Insights',
      insightsEmpty: 'Insights appear once runs exist',
      runsByStatus: 'Runs by status',
      runsByStatusDescription: 'Chat runs started per day',
      sessionsPerDay: 'Sessions per day',
      successRate: 'Success rate',
      successRateDescription: 'Succeeded ÷ finished runs',
      runDuration: 'Run duration',
      runDurationMedian: 'median {seconds}s',
      runDurationFallback: 'Completed runs',
      latency: 'Latency',
      latencyDescription: 'Run duration per day · p50 / p95 (s)',
      tokensCost: 'Tokens & cost',
      tokensCostMock: 'Estimated from runs (mock)',
      tokensCostUnavailable: 'Not reported by agent-api yet',
      tokensLegend: 'k tokens',
      tokensEmpty: 'Token usage is not exposed by the API',
      activity: 'Activity',
      activityDescription: 'Runs, sessions and task updates · last 12 weeks',
      scheduleTriggers: 'Schedule triggers',
      scheduleTriggersCount: '{count} occurrences across {schedules} schedules',
      scheduleTriggersEmpty: 'No triggers in this range',
      providerUsage: 'Provider usage',
      providerUsageMock: 'Runs per connection',
      providerUsageLive: 'Connections (per-run attribution not exposed by API)',
      providerUsageEmpty: 'No providers',
      topApps: 'Top apps · tasks',
      inFlight: 'In flight',
      inFlightDescription: '{inflight} running or waiting · {total} tasks total',
      inFlightEmpty: 'Nothing running',
      tasksByStatus: 'Tasks by status',
      tasksByStatusEmpty: 'No tasks yet',
      series: {
        succeeded: 'Succeeded',
        failed: 'Failed',
        active: 'Active',
        skipped: 'Skipped',
        missed: 'Missed',
        sessions: 'Sessions',
        runs: 'Runs',
        successPct: 'Success %',
        failedOrMissed: 'Failed / missed'
      },
      durations: {
        under5: '<5s',
        to10: '5–10s',
        to20: '10–20s',
        to40: '20–40s',
        over40: '>40s'
      }
    },
    inFlight: {
      workflow: 'Workflow',
      updated: 'Updated'
    },
    recentSessions: {
      title: 'Recent sessions'
    }
  },
  chat: {
    newSession: 'New session',
    filterSessions: 'Filter sessions',
    empty: {
      archived: 'No archived sessions',
      none: 'No sessions yet',
      hint: 'Start a conversation with the run agent.'
    },
    noSelection: {
      title: 'No session selected',
      hint: 'Pick a session from the list, or start a new one.'
    },
    commandMenu: 'Command menu',
    header: {
      archivedBadge: 'Archived',
      created: 'created {time}',
      run: 'run',
      runs: 'runs'
    },
    tabs: {
      chatHint: 'Conversation',
      runs: 'Runs',
      runsHint: 'Run history'
    },
    archive: 'Archive',
    unarchive: 'Unarchive',
    deleteSession: 'Delete session',
    deleteConfirm: 'Delete this session permanently?',
    sessionTitleAttr: 'Session {id}',
    runs: {
      empty: 'No runs yet.',
      started: 'Started',
      completed: 'Completed',
      attempt: 'Attempt',
      durationTitle: 'Run duration',
      durationDescription: 'Seconds per run, colored by outcome'
    },
    activity: {
      empty: 'No activity yet. Write the first message below — each one starts a run you can follow live.'
    },
    run: {
      started: 'Run started',
      attempt: 'attempt {attempt}',
      called: 'Called {tool}',
      calling: 'Calling {tool}',
      calledChip: 'Called',
      callingChip: 'Calling',
      taskStatus: 'Task {status}',
      task: 'Task',
      reason: 'Reason',
      writing: 'Writing the answer',
      waiting: 'Waiting for the model',
      failed: 'Run failed',
      completed: 'Run completed',
      thinking: 'Thinking',
      failedAfter: 'Failed after {took}',
      workedFor: 'Worked for {took}',
      generating: 'Generating',
      toolCallsOne: '{tools} tool call',
      toolCallsMany: '{tools} tool calls',
      artifactOne: '{artifacts} artifact',
      artifactMany: '{artifacts} artifacts',
      toolCallsAndArtifacts: '{tools}, {artifacts}'
    },
    followUps: {
      summarize: 'Summarize that in 3 bullets',
      next: 'What should I do next?'
    },
    composer: {
      mockPlaceholder: 'Mock mode is read-only — sending is disabled',
      placeholder: 'Ask the run agent — @ to reference a task, / for commands'
    },
    commands: {
      new: 'Start a new session',
      archive: 'Archive this session',
      unarchive: 'Unarchive this session',
      retry: 'Retry the last failed run',
      runs: 'Show run history'
    },
    sources: {
      taskTypeFallback: 'task'
    },
    stream: {
      live: 'Live',
      connecting: 'Connecting',
      reconnecting: 'Reconnecting',
      closed: 'Offline'
    }
  },
  tasks: {
    tabs: {
      all: 'All tasks',
      active: 'Active',
      done: 'Completed',
      activity: 'Activity',
      runLogs: 'Run logs',
      artifacts: 'Artifacts',
      raw: 'Raw'
    },
    empty: {
      title: 'No tasks',
      hint: 'Tasks appear here when chat messages are promoted or schedules fire.'
    },
    health: {
      title: 'Health',
      description: 'Status mix and daily activity across all tasks.',
      statusDistribution: 'Status distribution',
      totalTasks: '{count} tasks',
      succeeded: 'succeeded',
      updatesPerDay: 'Updates per day',
      updatesPerDayDescription: 'Last 14 days, by current status'
    },
    inFlight: {
      title: 'In flight',
      description: 'Running or waiting tasks, newest first.',
      workflow: 'Workflow',
      target: 'Target',
      updated: 'Updated'
    },
    all: {
      title: 'All tasks',
      description: 'Click a row to open the task.'
    },
    columns: {
      task: 'Task',
      status: 'Status',
      type: 'Type',
      target: 'Target',
      attempt: 'Attempt',
      lastUpdate: 'Last update'
    },
    footer: '{inflight} in flight · {failed} failed',
    detail: {
      cancelConfirm: 'Cancel this task?',
      properties: 'Properties',
      status: 'Status',
      type: 'Type',
      attempt: 'Attempt',
      revision: 'Revision',
      lifecycle: 'Lifecycle',
      execution: 'Execution',
      workflow: 'Workflow',
      target: 'Target',
      freshness: 'Freshness',
      session: 'Session',
      timestamps: 'Timestamps',
      updated: 'Updated',
      observed: 'Observed',
      taskFallback: 'Task'
    },
    approval: {
      pausedEyebrow: 'Paused — waiting for you',
      effectUnknownEyebrow: 'Effect unknown — needs a decision',
      pausedQuestion: 'This task is paused. How should it continue?',
      effectUnknownQuestion: 'The last side effect could not be confirmed. How should the agent proceed?',
      resumeDescription: 'Send the resume signal and continue from the checkpoint',
      cancelLabel: 'Cancel task',
      cancelDescription: 'Stop the workflow; it will not run again',
      retryLabel: 'Retry the task',
      retryDescription: 'Start a new attempt (the effect may happen twice)',
      cancelAndInvestigate: 'Stop here and investigate the run logs'
    },
    events: {
      empty: 'No activity yet.',
      steps: '{count} steps',
      stepsOver: '{count} steps over {span}',
      waiting: 'Waiting for the next step'
    },
    runLogs: {
      empty: 'No run logs. Run logs exist only for durable coordinator (v2) tasks.',
      eventsIn: '{count} events in {attempt}',
      more: 'More events available…'
    },
    artifacts: {
      empty: 'No artifacts.',
      download: 'Download',
      select: 'Select an artifact to preview it.'
    }
  },
  schedules: {
    new: 'New schedule',
    dialog: {
      description: 'Run an agent app task on a cron or interval.'
    },
    empty: {
      title: 'No schedules',
      hint: 'Run an agent app task on a cron or interval.'
    },
    trigger: {
      cron: 'cron {expression} ({timezone})',
      every: 'every {minutes} min'
    },
    activity: {
      title: 'Activity',
      description: 'Trigger outcomes over the last 14 days and what fires next.',
      triggerHistory: 'Trigger history',
      occurrences: '{count} occurrences',
      nextRuns: 'Next runs',
      minutesUntilNext: 'Minutes until next fire',
      hoursMinutes: '{hours}h {minutes}m',
      minutes: '{minutes}m'
    },
    sections: {
      active: 'Active',
      paused: 'Paused',
      activeDescription: 'Firing on their trigger.',
      pausedDescription: 'Will not fire until resumed.'
    },
    row: {
      revision: 'REV {revision}',
      next: 'next {time}'
    },
    form: {
      paramsError: 'params must be valid JSON',
      scheduleId: 'Schedule ID',
      scheduleIdHint: 'lowercase, [a-z0-9._-], ≥3 chars',
      displayName: 'Display name',
      releaseId: 'Release ID (binding anchor)',
      releaseBinding: 'Release binding',
      contentDigest: 'Content digest',
      trigger: 'Trigger',
      cronExpression: 'Cron expression',
      timezone: 'Timezone',
      every: 'Every (minutes, ≥1)',
      overlapPolicy: 'Overlap policy',
      misfirePolicy: 'Misfire policy',
      environment: 'Environment',
      budgetRunsLimit: 'Budget: runs limit',
      invocationTask: 'Invocation task',
      invocationTaskHint: '^[a-z][a-z0-9-]*$, e.g. finance-brief',
      invocationParams: 'Invocation params (JSON)',
      tenantPrefix: 'tenantId:',
      tenantSuffix: '(change in Settings)',
      submit: 'Create schedule'
    },
    detail: {
      rev: 'rev {revision}',
      deleteConfirm: 'Delete schedule {schedule}?',
      properties: 'Properties',
      state: 'State',
      trigger: 'Trigger',
      task: 'Task',
      binding: 'Binding',
      followLatest: 'Follow latest',
      overlap: 'Overlap',
      misfire: 'Misfire',
      constraints: 'Constraints',
      envs: 'Envs',
      budget: 'Budget',
      timestamps: 'Timestamps',
      nextFire: 'Next fire',
      created: 'Created',
      updated: 'Updated',
      revision: 'Revision',
      workflow: 'Workflow',
      workflowDescription: 'Trigger → guard rails → task.',
      triggerHistory: 'Trigger history',
      triggerHistoryDescription: 'Most recent 30 occurrences.',
      noTriggers: 'No triggers yet.',
      occurrence: 'Occurrence',
      error: 'Error',
      detail: 'Detail',
      rawDefinition: 'Raw definition'
    },
    flow: {
      trigger: 'Trigger',
      policy: 'Policy',
      task: 'Run task',
      guardRails: 'Guard rails',
      pausedNoFire: 'Paused — will not fire',
      nextFire: 'Next fire {time}',
      pinned: 'Pinned {release}',
      followsLatest: 'Follows latest release',
      overlap: 'overlap',
      misfire: 'misfire'
    }
  },
  apps: {
    import: {
      action: 'Import example app',
      title: 'Import example app',
      description: 'Bundled source packages from this repository. Existing apps are never overwritten.',
      choose: 'Example',
      loading: 'Loading example…',
      importing: 'Importing…',
      success: 'Imported {app}. {files} source files are now available in the app.',
      exists: '{app} is already registered. Nothing was changed.',
      failed: 'Import failed.',
      view: 'View app',
      done: 'Done',
      retry: 'Retry',
      existsHidden: 'An app with this id already exists server-side but is not listed (for example, it was deleted). Example app ids are restored only when the app is newly created, so choose another example.',
      existsBadge: 'Registered'
    },
    empty: {
      title: 'No apps',
      hint: 'Import a bundled example here, or register an agent package via agent-api (pnpm --filter @sage/agent-api register-package).'
    },
    all: {
      title: 'All apps',
      description: 'Registered agent apps. Click a row for releases, tasks and assets.'
    },
    columns: {
      app: 'App',
      status: 'Status',
      latestVersion: 'Latest version',
      runs: 'Runs · 14d',
      releases: 'Releases',
      created: 'Created',
      lastUpdate: 'Last update'
    },
    examples: {
      finance: {
        name: 'Finance briefing',
        description: 'Fetches FX rates and global index snapshots, then writes a structured market brief.'
      },
      github: {
        name: 'GitHub trending',
        description: 'Reads a GitHub trending snapshot and produces a ranked digest with highlights.'
      },
      lifecycle: {
        name: 'Lifecycle probe',
        description: 'Smallest package with no inputs or references; useful for a create → release → run smoke test.'
      }
    },
    detail: {
      deleteConfirm: 'Delete app {app}?',
      properties: 'Properties',
      status: 'Status',
      version: 'Version',
      entry: 'Entry',
      model: 'Model',
      created: 'Created',
      skills: 'Skills',
      capabilities: 'Capabilities',
      descriptionFallback: 'Agent app manifest, tasks, inputs and bundled assets.',
      tasks: 'Tasks',
      inputs: 'Inputs & data sources',
      input: 'INPUT',
      source: 'SOURCE',
      required: 'required',
      optional: 'optional',
      assets: 'Assets',
      rawManifest: 'Raw manifest',
      releases: 'Releases',
      openPackage: 'Package',
      run: 'Run',
      runs: 'Runs',
      runsEmpty: 'No runs yet. Start one from a release.',
      unknownVersion: 'Unknown version',
      sourceManual: 'Manual',
      sourceSchedule: 'Schedule'
    },
    run: {
      title: 'Run {app}',
      description: 'Start a new run from release v{version}. Parameters come from the manifest inputs.',
      task: 'Task',
      required: '{name} is required',
      number: '{name} must be a number',
      numberHint: 'Sent as a number',
      enumEmpty: '—',
      dataSources: 'Data sources',
      dataSourcesHint: 'Read-only declarations from the manifest; the runtime resolves them, this form does not send them.',
      providerMissing: 'No enabled workspace provider with a stored credential matches this manifest. Add one and select it as the run agent default.',
      openProviders: 'Open providers',
      mockDisabled: 'Mock mode is read-only — start a run against agent-api to try this.',
      submit: 'Start run',
      starting: 'Starting…'
    },
    runDetail: {
      properties: 'Properties',
      status: 'Status',
      version: 'Version',
      source: 'Source',
      task: 'Task',
      created: 'Created',
      updated: 'Updated',
      release: 'Release',
      releaseId: 'Release ID',
      freshness: 'Freshness',
      failureCode: 'Failure code',
      description: 'App run detail, logs and artifacts.',
      updatedAgo: 'updated {time}',
      openTask: 'Open task',
      overview: 'Overview',
      statusHint: 'Status comes from the task projection; pending means no projection has been observed yet.',
      pendingHint: 'The run was admitted and is waiting for the first task projection. Logs and artifacts appear once the task starts.',
      tabs: {
        overview: 'Overview',
        logs: 'Run logs',
        artifacts: 'Artifacts'
      }
    }
  },
  packages: {
    empty: {
      title: 'No packages'
    },
    all: {
      title: 'All packages',
      description: 'Published agent packages and their latest content digest.'
    },
    columns: {
      package: 'Package',
      latestVersion: 'Latest version',
      installs: 'Installs · 14d',
      releases: 'Releases',
      contentDigest: 'Content digest',
      lastUpdate: 'Last update'
    },
    detail: {
      description: 'Package registry record and releases.',
      summary: 'Manifest',
      version: 'Version',
      entry: 'Entry',
      model: 'Model',
      tasks: 'Tasks',
      skills: 'Skills',
      assets: 'Assets',
      releases: 'Releases',
      releasesEmpty: 'No releases',
      openApp: 'Open app',
      run: 'Run',
      raw: 'Raw package detail',
      showRaw: 'Show raw JSON'
    }
  },
  providers: {
    description: 'Model provider connections used by the run agent. Pick from the models.dev catalog or enter a custom endpoint; API keys are sealed server-side and never returned.',
    addConnection: 'Add connection',
    dialog: {
      title: 'Add provider connection',
      description: 'Auto-filled from the models.dev snapshot — base URL and model stay editable. The API key is sealed server-side and never returned.'
    },
    connections: {
      title: 'Connections',
      configured: '{count} configured',
      empty: 'No connections',
      emptyHint: 'Add one to let the agent call a model.',
      default: 'Default',
      env: 'env',
      makeDefault: 'Make default',
      deleteConfirm: 'Delete {name}?'
    },
    usage: {
      title: 'Usage',
      descriptionMock: 'Requests and errors per provider connection · last 14 days (mock).',
      descriptionLive: 'Per-provider request metrics are not exposed by agent-api yet.',
      empty: 'No usage metrics available.',
      chartTitle: 'Requests by provider',
      chartDescription: '{requests} requests · {errors} errors',
      requests: 'Requests',
      errors: 'Errors'
    },
    runAgent: {
      title: 'Run agent',
      description: 'Default connection used when a chat message does not choose one.',
      defaultConnection: 'Default connection',
      updatedBy: 'Updated {time} by {user}',
      unset: 'Unset'
    },
    catalog: {
      title: 'Model catalog',
      description: 'models.dev snapshot used for provider and model metadata.',
      availability: 'Availability',
      providersModels: 'Providers / models',
      lastSync: 'Last sync',
      nextSync: 'Next sync'
    },
    create: {
      fromCatalog: 'From models.dev',
      manual: 'Manual',
      catalogWarning: 'Catalog snapshot is {availability} (last sync {time}) — provider search may come up empty. Manual mode always works.',
      provider: 'Provider',
      providerCount: '{count} providers in the models.dev snapshot',
      model: 'Model',
      modelHint: 'Pick a model from the snapshot, or type a model id and choose “Use …”.',
      modelSelected: 'Selected: {model}',
      searchProviders: 'Search providers…',
      noProvidersMatch: 'No providers match',
      shown: '{count} shown',
      typeToNarrow: 'type to narrow',
      pickProviderFirst: 'Pick a provider first',
      searchModels: 'Search models…',
      noModelsMatch: 'No models match',
      showingFirst60: 'Showing the first 60 — type to narrow',
      noEndpoint: 'no endpoint',
      useCustom: 'Use “{model}”',
      customModelId: 'custom model id',
      baseUrl: 'Base URL',
      invalidUrl: 'Must be a public HTTPS URL.',
      useCatalogDefault: 'Use catalog default',
      noCatalogEndpoint: 'models.dev has no endpoint for this provider — enter one (proxy or gateway is fine)',
      publicHttpsHint: 'Public HTTPS endpoint — override it for a proxy or gateway',
      anthropicHint: 'Anthropic calls normalize a trailing /v1',
      adapter: 'Adapter',
      modelId: 'Model ID',
      name: 'Name',
      namePlaceholder: 'Shown in the connection list',
      apiKey: 'API key',
      testing: 'Testing…',
      test: 'Test connection'
    },
    baseUrlSource: {
      model: 'models.dev model endpoint',
      provider: 'models.dev provider endpoint',
      known: 'known default endpoint (not from models.dev)'
    }
  },
  settings: {
    searchPlaceholder: 'Search {title}',
    resetToDefaults: 'Reset to defaults',
    pages: {
      appearance: { title: 'Appearance', description: 'How the console looks in this browser.' },
      shortcuts: { title: 'Keyboard shortcuts', description: 'Navigate the console without leaving the keyboard.' },
      general: { title: 'Connection', description: 'How the console reaches agent-api. Stored in localStorage only.' },
      mcp: { title: 'MCP', description: 'Let external MCP clients such as Claude Code operate Sage.' },
      status: { title: 'Status', description: 'Live probes against agent-api.' },
      developer: { title: 'Developer', description: 'Tools for UI development and screenshots.' }
    },
    groups: {
      preferences: 'Preferences',
      system: 'System'
    },
    nav: {
      appearance: 'Appearance',
      shortcuts: 'Shortcuts',
      connection: 'Connection',
      mcp: 'MCP',
      status: 'Status',
      developer: 'Developer'
    },
    appearance: {
      card: 'Theme',
      title: 'Color theme',
      description: 'System follows your OS preference.',
      language: 'Language',
      languageDescription: 'Follows the browser language; defaults to English.',
      languageAuto: 'Auto',
      languageEnglish: 'English',
      languageChinese: '中文',
      light: 'Light',
      dark: 'Dark',
      system: 'System'
    },
    shortcuts: {
      general: 'General',
      navigation: 'Navigation',
      notSet: 'Not set',
      reset: 'Reset to default',
      resetAria: 'Reset {label}',
      clear: 'Clear shortcut',
      clearAria: 'Clear {label}'
    },
    shell: {
      searchAria: 'Search settings',
      empty: 'No settings match “{query}”.'
    },
    general: {
      apiBaseUrl: { title: 'API base URL', description: 'Empty = same origin; dev server proxies /v1 to :9610.', placeholder: 'Same origin' },
      tenantId: { title: 'Tenant ID', description: 'Must equal agent-api SAGE_TENANT_ID.' },
      saved: 'Saved',
      save: 'Save changes'
    },
    mcp: {
      card: 'MCP server',
      endpoint: { title: 'Endpoint', description: 'Streamable HTTP URL for MCP clients; derived from the API base URL on the Connection page.' },
      apiKey: {
        title: 'API key',
        description: 'Used only by external MCP clients, sent as Authorization: Bearer. Set the same key as SAGE_SERVICE_TOKEN_HASHES.',
        placeholder: 'Not set',
        reveal: 'Show key',
        hide: 'Hide key'
      },
      command: { title: 'Connect command', description: 'Register Sage in Claude Code or any MCP client.' },
      test: {
        title: 'Connection test',
        description: 'Runs initialize + tools/list against the endpoint with the API key above.',
        button: 'Test connection',
        running: 'Testing…',
        ok: 'Connected: {server} · {count} tools',
        unreachable: 'Cannot reach {url}',
        failed: 'Failed: {status} {code}',
        mock: 'Mock mode is a read-only demo — real connections are not tested.'
      }
    },
    status: {
      card: 'Probes',
      liveness: 'Liveness',
      readiness: 'Readiness',
      unreachable: 'Unreachable'
    },
    developer: {
      card: 'Data',
      mockData: 'Mock data',
      mockDescription: 'Read-only demo dataset. Also toggled with ?mock=1 / ?mock=0.'
    }
  },
  notFound: {
    header: 'Not found',
    title: 'Page not found',
    descriptionLead: 'Nothing lives at',
    descriptionTail: '.',
    back: 'Back to overview'
  },
  /** Shared component chrome: ui primitives, shell, bui blocks and chart defaults. */
  ui: {
    loading: 'Loading',
    error: {
      requestFailed: 'Request failed. '
    },
    combobox: {
      placeholder: 'Search…',
      empty: 'No matches',
      loading: 'Loading…'
    }
  },
  /**
   * Server error codes → console copy, rendered by `lib/error-message.ts` (never shown verbatim as a key).
   * Plain keys are exact agent-api `sendError` codes; `_SUFFIX` keys back passthrough families
   * (`SOURCE_*`, `PACKAGE_LOCK_*`, …) and win by longest prefix. The inventory lives in
   * `lib/error-codes.ts`; an unregistered code falls back to the raw server message.
   */
  errors: {
    // apps-api.ts
    APP_ALREADY_EXISTS: 'An app with this id already exists.',
    APP_AUTHENTICATION_REQUIRED: 'App API requires authentication.',
    APP_NOT_FOUND: 'App not found.',
    APP_OPERATION_REJECTED: 'The app operation was rejected.',
    APP_PACKAGE_ID_MISMATCH: 'The uploaded package does not match this app.',
    APP_UNAVAILABLE: 'App API is temporarily unavailable.',
    APP_UPLOAD_UNTRUSTED_FIELD: 'Untrusted fields were rejected.',
    // runs-api.ts
    INPUT_REMOVED: 'Free-form input was removed: submit declared params (see manifest inputs) or start from Chat promotion.',
    PACKAGE_RUN_UNTRUSTED_FIELD: 'Untrusted fields were rejected.',
    PACKAGE_RUN_ADMISSION_NOT_AVAILABLE: 'Package run admission is not available in this deployment mode.',
    PACKAGE_RUN_AUTHENTICATION_REQUIRED: 'Package run API requires authentication.',
    IDEMPOTENCY_KEY_INVALID: 'Idempotency-Key must be a single string of 1-255 characters.',
    RELEASE_NOT_FOUND: 'Release not found.',
    PACKAGE_RUN_MANIFEST_MISSING: 'Release has no manifest summary.',
    PROVIDER_DEPENDENCY_MISSING: 'A required provider dependency is missing.',
    PACKAGE_RUN_ENTRY_MISSING: 'Release has no entry prompt content.',
    PACKAGE_PARAMS_INVALID: 'Package parameters are invalid.',
    PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: 'The package snapshot source is unavailable.',
    PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT: 'Package run idempotency conflict.',
    ADMISSION_SPEC_COMMIT_FAILED: 'Spec commit failed.',
    PACKAGE_RUN_REJECTED: 'The package run was rejected.',
    PACKAGE_RUN_UNAVAILABLE: 'Package run is temporarily unavailable.',
    // packages-api.ts
    PACKAGE_AUTHENTICATION_REQUIRED: 'Package API requires authentication.',
    PACKAGE_REGISTRATION_REJECTED: 'The package registration was rejected.',
    PACKAGE_UNAVAILABLE: 'Package API is temporarily unavailable.',
    PACKAGE_NOT_FOUND: 'Package not found.',
    PACKAGE_REGISTRATION_UNTRUSTED_FIELD: 'Untrusted fields were rejected.',
    PACKAGE_OPERATION_FORBIDDEN: 'This action needs the package-registrar role.',
    // schedules-api.ts
    SCHEDULE_RULE_INVALID: 'The schedule definition is invalid.',
    SCHEDULE_FORBIDDEN: 'Schedule tenant mismatch.',
    SCHEDULE_VALIDATION_FAILED: 'Schedule binding validation failed.',
    SCHEDULE_ALREADY_EXISTS: 'Schedule already exists.',
    SCHEDULE_NOT_FOUND: 'Schedule not found.',
    SCHEDULE_REVISION_CONFLICT: 'Schedule revision conflict.',
    SCHEDULE_STORE_UNAVAILABLE: 'Schedule store is unavailable.',
    // catalog-api.ts
    CATALOG_INVALID_REQUEST: 'The provider catalog request is invalid.',
    CATALOG_SYNC_ATTEMPT_NOT_FOUND: 'Provider catalog sync attempt not found.',
    CATALOG_UNAVAILABLE: 'Provider catalog is temporarily unavailable.',
    CATALOG_AUTHENTICATION_REQUIRED: 'Provider catalog requires authentication.',
    CATALOG_SYNC_FORBIDDEN: 'Provider catalog sync is forbidden.',
    CATALOG_PROJECTION_UNAVAILABLE: 'Provider catalog projection is unavailable.',
    CATALOG_CURSOR_SNAPSHOT_CHANGED: 'Provider catalog changed while paging; start again from the first page.',
    CATALOG_SYNC_RATE_LIMITED: 'Provider catalog sync is rate limited; retry later.',
    CATALOG_SHUTTING_DOWN: 'Provider catalog is shutting down.',
    // provider-connections-api.ts
    PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED: 'Provider connections API requires authentication.',
    PROVIDER_CONNECTIONS_UNAVAILABLE: 'Provider connection store is unavailable.',
    PROVIDER_CONNECTION_UNTRUSTED_FIELD: 'Untrusted fields were rejected.',
    PROVIDER_CONNECTION_INVALID_REQUEST: 'The provider connection request is invalid.',
    SECRET_BACKEND_UNAVAILABLE: 'The secret backend is unavailable.',
    PROVIDER_CONNECTION_NOT_FOUND: 'Provider connection not found.',
    PROVIDER_CONNECTION_PROTECTED: 'Deployment-env connections are maintained by the trusted bootstrap and cannot be changed here.',
    PROVIDER_CONNECTION_IN_USE: 'This provider connection is referenced by run agent settings; clear the reference before deleting.',
    // run-agent-settings-api.ts
    RUN_AGENT_SETTINGS_AUTHENTICATION_REQUIRED: 'Run agent settings API requires authentication.',
    RUN_AGENT_SETTINGS_UNAVAILABLE: 'Run agent settings store is unavailable.',
    RUN_AGENT_SETTINGS_UNTRUSTED_FIELD: 'Untrusted fields were rejected.',
    RUN_AGENT_SETTINGS_INVALID_PROVIDER: 'Pick a provider connection that is enabled and has a stored credential.',
    // effect-resolutions-api.ts
    EFFECT_RESOLUTION_INVALID: 'The effect resolution request is invalid.',
    // chat kernel (chat-compatibility.ts)
    HARNESS_FAILURE: 'The agent run failed.',
    CANCELLED: 'The agent run was cancelled.',
    // passthrough families — longest prefix wins (see lib/error-codes.ts)
    _SOURCE_ARCHIVE: 'The package source archive is invalid.',
    _SOURCE: 'The package source failed validation.',
    _PACKAGE_LOCK: 'The package dependency lock failed validation.',
    _PACKAGE_OUTPUT: 'The package output failed validation.',
    _PACKAGE: 'The agent package failed validation.',
    _KERNEL: 'The run kernel rejected the operation.',
    _CAPABILITY: 'The capability check failed.',
    _CHECKPOINT: 'The checkpoint operation failed.',
    _LEDGER: 'The effect ledger rejected the operation.',
    _EVENT: 'The run event stream conflicted.',
    _ENVELOPE: 'The run envelope is invalid.',
    _SPEC: 'The run spec is unavailable or invalid.',
    _REPLAY: 'The replay check failed.',
    _RETRY: 'The retry budget is exhausted.',
    _EFFECT: 'The effect outcome is unknown or conflicting.',
    _USAGE: 'The usage ledger rejected the operation.',
    _IDENTITY: 'The identity check failed.',
    _MIGRATION: 'The migration failed.',
    _ADMISSION: 'The run admission check failed.',
    _CANDIDATE: 'The candidate is invalid.',
    _ENGINE: 'The engine binding is invalid.',
    _COMMAND: 'The command conflicted with the current state.',
    _TARGET: 'The effect target is unavailable.',
    _CHAIN: 'The effect chain is missing or conflicting.',
    _RECEIPT: 'The receipt is unavailable.',
    _OBSERVATION: 'The observation is unstable.',
    _RELEASE: 'The release registry operation failed.',
    _API: 'The release registry API call failed.'
  },
  appShell: {
    search: 'Search (⌘K)',
    collapseSidebar: 'Collapse sidebar (⌘B)',
    expandSidebar: 'Expand sidebar (⌘B)',
    mockTitle: 'Demo data — click to exit mock mode',
    mockLabel: 'Mock data · read-only',
    mockExit: 'Exit',
    sameOrigin: 'same-origin',
    online: 'Online',
    offline: 'Offline',
    toggleTheme: 'Toggle theme'
  },
  commandPalette: {
    title: 'Command palette',
    description: 'Navigate and run commands',
    placeholder: 'Type a command or search…',
    empty: 'No results.',
    goTo: 'Go to {page}',
    groups: {
      navigation: 'Navigation',
      actions: 'Actions',
      recentSessions: 'Recent sessions'
    },
    newChat: 'New chat session',
    theme: 'Theme: {theme}'
  },
  /** Keyboard-shortcut vocabulary — `lib/shortcuts.ts` stores these keys (single source of truth). */
  shortcuts: {
    palette: { label: 'Command menu', description: 'Search pages, sessions and actions' },
    sidebar: { label: 'Toggle sidebar', description: 'Collapse or expand the main sidebar' },
    'go-overview': { label: 'Go to Overview', description: 'Charts and recent activity' },
    'go-chat': { label: 'Go to Chat', description: 'Conversations with the run agent' },
    'go-tasks': { label: 'Go to Tasks', description: 'All tasks and their status' },
    'go-schedules': { label: 'Go to Schedules', description: 'Recurring triggers' },
    'go-apps': { label: 'Go to Apps', description: 'Registered agent apps' },
    'go-packages': { label: 'Go to Packages', description: 'Published agent packages' },
    'go-providers': { label: 'Go to Providers', description: 'Model provider connections' },
    'go-settings': { label: 'Go to Settings', description: 'This page' },
    send: { label: 'Send message', description: 'In the chat composer' }
  },
  sessionList: {
    noRuns: 'No runs',
    buckets: {
      today: 'Today',
      yesterday: 'Yesterday',
      earlier: 'Earlier'
    },
    agentPrefix: 'Agent: ',
    youPrefix: 'You: ',
    runOne: 'run',
    runMany: 'runs',
    messages: 'msg',
    recentRuns: 'Recent runs',
    sessionTitle: 'Session title',
    sessionView: 'Session view',
    filterArchived: 'Archived',
    filterActive: 'Active'
  },
  promptBar: {
    placeholder: 'Ask anything — @ to reference, / for commands',
    promptAria: 'Prompt',
    reference: 'Reference (@)',
    providerConnection: 'Provider connection',
    serverDefault: 'Server default',
    send: 'Send',
    sendTitle: 'Send (Enter)',
    noMatches: 'No matches',
    footerSources: 'Type to search tasks, apps & schedules',
    footerCommands: 'Commands run locally in this console'
  },
  recordsTable: {
    count: 'count'
  },
  taskRows: {
    details: 'Details'
  },
  thinking: {
    active: 'Thinking'
  },
  loadingState: {
    working: 'Working'
  },
  codeBlock: {
    copyAria: 'Copy code'
  },
  insightCards: {
    title: 'Insights',
    trendSnapshot: 'Trend snapshot',
    previous: 'Previous insight',
    next: 'Next insight',
    points: '{count} pts'
  },
  approvalCard: {
    confirm: 'Continue',
    notNow: 'Not now',
    working: 'Working…'
  },
  charts: {
    noData: 'No data in this range',
    heatmap: 'Activity heatmap'
  }
} as const;
