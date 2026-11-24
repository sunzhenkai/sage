import * as z from 'zod';
import type { ToolDef } from './types.js';

/** net_probe_rule / ssh_target 能力控制面工具组。 */

export const netProbeRuleTools: readonly ToolDef[] = [
  {
    name: 'net_probe_rule_list',
    description: 'List dynamic network probe allowlist rules.',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/net-probe-rules' }),
  },
  {
    name: 'net_probe_rule_upsert',
    description: 'Create or update a network probe allowlist rule (supports *.domain.tld wildcards).',
    schema: {
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      pattern: z.string().min(3).max(255),
      ports: z.array(z.number().int().min(1).max(65_535)).min(1).max(16).optional(),
      enabled: z.boolean().optional(),
      description: z.string().max(256).optional(),
    },
    build: (a) => ({
      method: 'PUT',
      path: `/v1/net-probe-rules/${encodeURIComponent(String(a.id ?? ''))}`,
      body: {
        pattern: a.pattern,
        ...(a.ports === undefined ? {} : { ports: a.ports }),
        ...(a.enabled === undefined ? {} : { enabled: a.enabled }),
        ...(a.description === undefined ? {} : { description: a.description }),
      },
    }),
  },
  {
    name: 'net_probe_rule_delete',
    description: 'Delete a network probe allowlist rule by id.',
    schema: {
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    },
    build: (a) => ({
      method: 'DELETE',
      path: `/v1/net-probe-rules/${encodeURIComponent(String(a.id ?? ''))}`,
    }),
  },
];

export const sshTargetTools: readonly ToolDef[] = [
  {
    name: 'ssh_target_list',
    description: 'List managed read-only SSH inspection targets (without private keys).',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/ssh-targets' }),
  },
  {
    name: 'ssh_target_upsert',
    description: 'Create or update a managed read-only SSH target and optionally seal its private key.',
    schema: {
      alias: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      host: z.string().min(1).max(255),
      port: z.number().int().min(1).max(65_535).optional(),
      username: z.string().min(1).max(64),
      knownHostEntry: z.string().max(2048).optional(),
      customChecks: z.record(z.string(), z.string()).optional(),
      enabled: z.boolean().optional(),
      privateKey: z.string().max(16_384).optional(),
    },
    build: (a) => ({
      method: 'PUT',
      path: `/v1/ssh-targets/${encodeURIComponent(String(a.alias ?? ''))}`,
      body: {
        host: a.host,
        ...(a.port === undefined ? {} : { port: a.port }),
        username: a.username,
        ...(a.knownHostEntry === undefined ? {} : { knownHostEntry: a.knownHostEntry }),
        ...(a.customChecks === undefined ? {} : { customChecks: a.customChecks }),
        ...(a.enabled === undefined ? {} : { enabled: a.enabled }),
        ...(a.privateKey === undefined ? {} : { privateKey: a.privateKey }),
      },
    }),
  },
  {
    name: 'ssh_target_delete',
    description: 'Delete a managed SSH target and its sealed credential.',
    schema: {
      alias: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    },
    build: (a) => ({
      method: 'DELETE',
      path: `/v1/ssh-targets/${encodeURIComponent(String(a.alias ?? ''))}`,
    }),
  },
];
