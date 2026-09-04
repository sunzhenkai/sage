import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Markdown, splitThinking } from "./markdown";

afterEach(() => {
  cleanup();
});

function renderMarkdown(text: string): HTMLElement {
  const { container } = render(<Markdown text={text} />);
  return container;
}

describe("splitThinking", () => {
  it("splits literal think tags from the rest", () => {
    expect(splitThinking("<think>secret</think>visible")).toEqual([
      { thinking: true, text: "secret" },
      { thinking: false, text: "visible" },
    ]);
  });

  it("matches tags case-insensitively", () => {
    expect(splitThinking("a<THINK>b</Think>c")).toEqual([
      { thinking: false, text: "a" },
      { thinking: true, text: "b" },
      { thinking: false, text: "c" },
    ]);
  });

  it("treats the remainder as thinking when the tag is unclosed", () => {
    expect(splitThinking("a<think>b")).toEqual([
      { thinking: false, text: "a" },
      { thinking: true, text: "b" },
    ]);
  });

  it("returns plain text untouched", () => {
    expect(splitThinking("plain")).toEqual([{ thinking: false, text: "plain" }]);
  });
});

describe("Markdown safe subset", () => {
  it("renders paragraphs and keeps soft line breaks", () => {
    const container = renderMarkdown("line one\nline two");
    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();
    expect(paragraph?.querySelector("br")).not.toBeNull();
    expect(paragraph?.textContent).toBe("line oneline two");
  });

  it("renders headings with the level capped at h4", () => {
    expect(renderMarkdown("# a").querySelector("h1")?.textContent).toBe("a");
    expect(renderMarkdown("#### d").querySelector("h4")?.textContent).toBe("d");
    const container = renderMarkdown("###### e");
    expect(container.querySelector("h4")?.textContent).toBe("e");
    expect(container.querySelector("h6")).toBeNull();
  });

  it("renders fenced code with the language marker preserved", () => {
    const container = renderMarkdown("```ts\nconst a = 1;\n```");
    const pre = container.querySelector("pre");
    expect(pre?.getAttribute("data-language")).toBe("ts");
    expect(pre?.querySelector("code")?.textContent).toBe("const a = 1;");
  });

  it("renders recursive blockquotes", () => {
    const container = renderMarkdown("> outer\n> > inner");
    const outer = container.querySelector("blockquote");
    expect(outer?.textContent).toContain("outer");
    expect(outer?.querySelector("blockquote")?.textContent).toContain("inner");
  });

  it("renders a horizontal rule", () => {
    expect(renderMarkdown("---").querySelector("hr")).not.toBeNull();
  });

  it("renders nested unordered and ordered lists", () => {
    const container = renderMarkdown("- a\n  - b\n- c");
    const topList = container.querySelector("ul");
    expect(topList).not.toBeNull();
    const items = topList?.querySelectorAll(":scope > li");
    expect(items).toHaveLength(2);
    expect(items?.[0]?.querySelector(":scope > ul")?.textContent).toBe("b");
    expect(items?.[1]?.textContent).toBe("c");

    const ordered = renderMarkdown("1. one\n2. two");
    expect(ordered.querySelector("ol")?.children).toHaveLength(2);
  });

  it("keeps soft line breaks inside a list item", () => {
    const container = renderMarkdown("- first\n  second line");
    const item = container.querySelector("li");
    expect(item?.querySelector("br")).not.toBeNull();
    expect(item?.textContent).toBe("firstsecond line");
  });

  it("renders GFM tables", () => {
    const container = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(container.querySelector("td")?.textContent).toBe("1");
  });

  it("renders inline code without parsing its contents", () => {
    const container = renderMarkdown("use `**not bold**` here");
    expect(container.querySelector("code")?.textContent).toBe("**not bold**");
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders emphasis: bold, italic, bold italic, strikethrough", () => {
    expect(renderMarkdown("**b**").querySelector("strong")?.textContent).toBe("b");
    expect(renderMarkdown("*i*").querySelector("em")?.textContent).toBe("i");
    const bi = renderMarkdown("***bi***");
    expect(bi.querySelector("strong em")?.textContent).toBe("bi");
    expect(renderMarkdown("~~s~~").querySelector("del")?.textContent).toBe("s");
  });

  it("allows http/https/mailto/slash/hash links; external links open safely", () => {
    const external = renderMarkdown("[x](https://example.com)").querySelector("a");
    expect(external?.getAttribute("href")).toBe("https://example.com");
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");

    const internal = renderMarkdown("[x](/docs)").querySelector("a");
    expect(internal?.getAttribute("href")).toBe("/docs");
    expect(internal?.getAttribute("target")).toBeNull();

    expect(renderMarkdown("[x](#anchor)").querySelector("a")?.getAttribute("href")).toBe("#anchor");
    expect(renderMarkdown("[x](mailto:a@b.c)").querySelector("a")?.getAttribute("href")).toBe("mailto:a@b.c");
    expect(renderMarkdown("[x](http://example.com)").querySelector("a")?.getAttribute("href")).toBe("http://example.com");
  });

  it("renders links with disallowed protocols as plain text", () => {
    const container = renderMarkdown("[x](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[x](javascript:alert(1))");
  });

  it("renders autolinks in angle brackets", () => {
    const anchor = renderMarkdown("see <https://example.com/a>").querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  it("renders bare URLs and strips trailing punctuation", () => {
    const container = renderMarkdown("see https://example.com/a, then go.");
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/a");
    expect(anchor?.textContent).toBe("https://example.com/a");
    expect(container.textContent).toContain(", then go.");
  });

  it("renders raw HTML as plain text and never injects it", () => {
    const container = renderMarkdown("<b>bold</b> <script>alert(1)</script>");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
