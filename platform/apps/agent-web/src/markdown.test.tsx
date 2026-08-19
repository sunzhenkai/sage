import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, parseBlocks, renderInline } from './markdown.js';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('markdown assistant rendering', () => {
  it('renders the assistant intro with bold labels and nested list levels', () => {
    const markup = html('你好！我是 **Sage**，一个本地化的工作助手。以下是我的基本背景：\n\n- **身份**：本地工作空间助手\n- **特点**：\n  - 直接、简洁地回答问题\n  - 使用与你相同的语言交流\n- **版本**：MiniMax-M3');
    expect(markup).toContain('<strong>Sage</strong>');
    expect(markup).toContain('<strong>身份</strong>：本地工作空间助手');
    expect(markup).toContain('<li><strong>特点</strong>：<ul><li>直接、简洁地回答问题</li><li>使用与你相同的语言交流</li></ul></li>');
    expect(markup.match(/<ul>/g)).toHaveLength(2);
    expect(markup).not.toContain('**');
  });

  it('renders ordered lists, headings, rules and blockquotes', () => {
    const markup = html('# 标题\n\n段落一。\n\n1. 第一\n2. 第二\n   1. 嵌套\n\n---\n\n> 引用内容\n> 第二行');
    expect(markup).toContain('<h1>标题</h1>');
    expect(markup).toContain('<br/>');
    expect(markup).toContain('<ol><li>第一</li><li>第二<ol><li>嵌套</li></ol></li></ol>');
    expect(markup).toContain('<hr/>');
    expect(markup).toContain('<blockquote><p>引用内容<br/>第二行</p></blockquote>');
  });

  it('renders fenced and inline code without inline styling inside', () => {
    const markup = html('运行 `npm test` 检查。\n\n```ts\nconst x = **not bold**;\n```');
    expect(markup).toContain('<code>npm test</code>');
    expect(markup).toContain('<pre><code class="language-ts">const x = **not bold**;</code></pre>');
  });

  it('renders markdown links and bare URLs while refusing javascript: hrefs', () => {
    const markup = html('见 [文档](https://example.com/docs) 与 https://example.com/a?b=1，以及 <https://example.com/c>。[危险](javascript:alert(1))');
    expect(markup).toContain('<a href="https://example.com/docs" target="_blank" rel="noreferrer noopener">文档</a>');
    expect(markup).toContain('<a href="https://example.com/a?b=1"');
    expect(markup).toContain('，以及 <a href="https://example.com/c"');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).toContain('[危险](javascript:alert(1))');
  });

  it('renders GFM tables', () => {
    const markup = html('| 名称 | 值 |\n| --- | --- |\n| CPU | 80% |\n| 内存 | 40% |');
    expect(markup).toContain('<table><thead><tr><th>名称</th><th>值</th></tr></thead><tbody><tr><td>CPU</td><td>80%</td></tr><tr><td>内存</td><td>40%</td></tr></tbody></table>');
  });

  it('keeps raw HTML in model output as inert escaped text', () => {
    const markup = html('试试 <script>alert(1)</script> 与 <img src=x onerror=alert(2)>');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img');
  });

  it('leaves plain conversational text untouched', () => {
    expect(html('hi back')).toBe('<div class="md"><p>hi back</p></div>');
  });
});

describe('markdown structure and inline edges', () => {
  it('splits paragraphs, lists and indented continuations into blocks', () => {
    const blocks = parseBlocks('第一段\n\n- 条目 A\n  条目 A 续行\n- 条目 B');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '第一段' },
      { kind: 'list', ordered: false, items: [{ text: '条目 A\n条目 A 续行', children: [] }, { text: '条目 B', children: [] }] }
    ]);
  });

  it('keeps stray arithmetic asterisks and underscores literal', () => {
    expect(renderInline('2 * 3 * 4 与 snake_case_name', 'k')).toEqual(['2 * 3 * 4 与 snake_case_name']);
  });

  it('trims sentence punctuation off trailing bare URLs', () => {
    expect(renderInline('访问 https://example.com/page。完成', 'k')).toEqual(['访问 ', <a key="k-0" href="https://example.com/page" target="_blank" rel="noreferrer noopener">https://example.com/page</a>, '。完成']);
  });

  it('drops emphasis marks around unmatched delimiters', () => {
    expect(html('未闭合 **加粗 与 *斜体')).toContain('未闭合 **加粗 与 *斜体');
  });
});
