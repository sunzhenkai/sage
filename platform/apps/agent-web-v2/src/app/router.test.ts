import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  navigateTo,
  parseRoute,
  shouldInterceptClick,
  useRoute,
  workspaceHref,
  type ClickEventLike,
} from "./router";

function plainClick(overrides: Partial<ClickEventLike> = {}): ClickEventLike {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...overrides,
  };
}

function anchor(href: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  const element = document.createElement("a");
  element.setAttribute("href", href);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("parseRoute", () => {
  it("falls back to chat without a view", () => {
    expect(parseRoute("")).toEqual({ view: "chat" });
    expect(parseRoute("?session=s1")).toEqual({ view: "chat", session: "s1" });
  });

  it("accepts every known view", () => {
    for (const view of ["chat", "tasks", "providers", "packages", "schedules"] as const) {
      expect(parseRoute(`?view=${view}`).view).toBe(view);
    }
  });

  it("falls back to chat for unknown views", () => {
    expect(parseRoute("?view=bogus")).toEqual({ view: "chat" });
    expect(parseRoute("?view=CHAT")).toEqual({ view: "chat" });
  });

  it("reads session, task and package", () => {
    expect(parseRoute("?view=tasks&task=t1&session=s1")).toEqual({ view: "tasks", task: "t1", session: "s1" });
    expect(parseRoute("?view=packages&package=p1")).toEqual({ view: "packages", package: "p1" });
  });

  it("ignores empty parameter values", () => {
    expect(parseRoute("?view=tasks&task=&session=")).toEqual({ view: "tasks" });
  });
});

describe("workspaceHref", () => {
  it("never writes view for chat", () => {
    expect(workspaceHref({ view: "chat" })).toBe("/");
    expect(workspaceHref({ view: "chat", session: "s1" })).toBe("?session=s1");
  });

  it("writes view for other views and keeps a fixed parameter order", () => {
    expect(workspaceHref({ view: "tasks" })).toBe("?view=tasks");
    expect(workspaceHref({ view: "tasks", task: "t1", session: "s1" })).toBe("?view=tasks&task=t1&session=s1");
    expect(workspaceHref({ view: "packages", package: "p1" })).toBe("?view=packages&package=p1");
    expect(workspaceHref({ view: "providers" })).toBe("?view=providers");
    expect(workspaceHref({ view: "schedules" })).toBe("?view=schedules");
  });

  it("only writes parameters that have values", () => {
    expect(workspaceHref({ view: "tasks", session: "s1" })).toBe("?view=tasks&session=s1");
  });

  it("encodes parameter values", () => {
    expect(workspaceHref({ view: "chat", session: "a b/c" })).toBe("?session=a+b%2Fc");
  });
});

describe("shouldInterceptClick", () => {
  it("intercepts plain left clicks on same-origin same-path links", () => {
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick())).toBe(true);
    expect(shouldInterceptClick(anchor("/?view=tasks"), plainClick())).toBe(true);
    expect(shouldInterceptClick(anchor("/"), plainClick())).toBe(true);
  });

  it("does not intercept modified or non-left clicks", () => {
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick({ button: 1 }))).toBe(false);
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick({ metaKey: true }))).toBe(false);
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick({ ctrlKey: true }))).toBe(false);
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick({ shiftKey: true }))).toBe(false);
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick({ altKey: true }))).toBe(false);
    expect(shouldInterceptClick(anchor("?view=tasks"), plainClick({ defaultPrevented: true }))).toBe(false);
  });

  it("does not intercept target or download links", () => {
    expect(shouldInterceptClick(anchor("?view=tasks", { target: "_blank" }), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("/v1/files/x?download=1", { download: "" }), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("?view=tasks", { target: "_self" }), plainClick())).toBe(true);
  });

  it("does not intercept hash, mailto, tel or data links", () => {
    expect(shouldInterceptClick(anchor("#details"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("mailto:a@example.com"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("tel:+123"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("data:text/plain,hello"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor(""), plainClick())).toBe(false);
  });

  it("does not intercept external or different-path links", () => {
    expect(shouldInterceptClick(anchor("https://example.com/?view=tasks"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("//example.com/x"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("/other-path?view=tasks"), plainClick())).toBe(false);
    expect(shouldInterceptClick(anchor("/v1/chat/sessions"), plainClick())).toBe(false);
  });
});

describe("useRoute", () => {
  it("parses the initial location and tracks navigateTo", () => {
    window.history.replaceState(null, "", "/?view=tasks&task=t1");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ view: "tasks", task: "t1" });

    act(() => navigateTo("/?view=packages&package=p1"));
    expect(result.current).toEqual({ view: "packages", package: "p1" });
    expect(window.location.search).toBe("?view=packages&package=p1");
  });

  it("refreshes on popstate", () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current.view).toBe("chat");

    act(() => {
      window.history.pushState(null, "", "/?session=s1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toEqual({ view: "chat", session: "s1" });
  });
});
