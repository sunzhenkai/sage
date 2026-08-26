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

export interface AssemblePackageInputInput {
  readonly entryPrompt: string;
  readonly references: readonly PackageInputAsset[];
  readonly userInput: string;
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
