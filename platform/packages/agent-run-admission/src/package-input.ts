import { sha256Digest, type ContentDigest } from '@sage/agent-contracts';

/**
 * 包运行输入拼装：entry prompt 正文 + references 清单 + 用户输入（可选）+ 资产 digest 清单。
 * v1 无模板引擎：纯文本拼接，输出即物化进 task_package_input 表；asset_digests
 * 供 Release 更新后审计重建。
 */

export interface PackageInputAsset {
  readonly relativePath: string;
  readonly content: string;
}

/** 已获取的输入快照：成功携带 content；markMissing 声明下失败时携带 unavailableReason。 */
export interface PackageInputSnapshot {
  readonly name: string;
  readonly url: string;
  readonly content: string;
  readonly unavailableReason?: string;
}

/** 准入解析后的任务参数（声明默认值或请求提供，类型已按 manifest inputs 校验）。 */
export interface PackageInputParam {
  readonly name: string;
  readonly value: string | number;
}

export interface AssemblePackageInputInput {
  readonly entryPrompt: string;
  readonly references: readonly PackageInputAsset[];
  readonly userInput: string;
  readonly snapshots?: readonly PackageInputSnapshot[];
  readonly params?: readonly PackageInputParam[];
}

export interface AssembledPackageInput {
  readonly text: string;
  readonly assetDigests: Readonly<Record<string, string>>;
  readonly digest: ContentDigest;
}

export function assemblePackageInput(input: AssemblePackageInputInput): AssembledPackageInput {
  const { entryPrompt, references, userInput } = input;
  const sections: string[] = [entryPrompt.trim()];
  if (references.length > 0) {
    sections.push('--- references ---');
    for (const reference of references) {
      sections.push(`[${reference.relativePath}]`);
      sections.push(reference.content.trim());
    }
  }
  // 快照分段：成功注入原文；markMissing 注入单行缺失标注，模型可感知部分覆盖。
  const snapshots = input.snapshots ?? [];
  if (snapshots.length > 0) {
    sections.push('--- snapshots ---');
    for (const snapshot of snapshots) {
      if (snapshot.unavailableReason === undefined) {
        sections.push(`[snapshot: ${snapshot.name}] (${snapshot.url})`);
        const content = snapshot.content.trim();
        if (content.length > 0) sections.push(content);
      } else {
        sections.push(`[snapshot: ${snapshot.name}] (${snapshot.url}) [snapshot ${snapshot.name} unavailable: ${snapshot.unavailableReason}]`);
      }
    }
  }
  // 参数分段：解析后的名值对；缺省输入已取默认值。
  const params = input.params ?? [];
  if (params.length > 0) {
    sections.push('--- params ---');
    for (const param of params) {
      sections.push(`${param.name}: ${String(param.value)}`);
    }
  }
  // 用户输入可选：app 自身即可完成特定任务时无需输入，空输入不追加该段。
  const trimmedUserInput = userInput.trim();
  if (trimmedUserInput.length > 0) {
    sections.push('--- user input ---');
    sections.push(trimmedUserInput);
  }
  const text = sections.join('\n\n');
  const assetDigests: Record<string, string> = {};
  for (const reference of references) {
    assetDigests[reference.relativePath] = sha256Digest(reference.content);
  }
  return {
    text,
    assetDigests,
    digest: sha256Digest({ text, assetDigests: Object.keys(assetDigests).sort().map((key) => [key, assetDigests[key]]) }),
  };
}
