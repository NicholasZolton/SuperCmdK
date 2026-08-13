import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  SuperCmdKProvider,
  createToolRegistry,
  useCommandChoice,
  useSuperCmdK,
  useTool,
  type CommandChoice,
  type Tool,
} from "../src";

const globalCommand: CommandChoice = {
  id: "open",
  label: "Open globally",
  run: () => {},
};

function PageCommands() {
  useCommandChoice({ id: "open", label: "Open on this page", run: () => {} }, []);
  return null;
}

const globalTool: Tool = {
  name: "current_page",
  description: "Return the current page",
  parameters: { type: "object" },
  execute: () => "global",
};

function PageTools() {
  useTool({ ...globalTool, execute: () => "page" }, []);
  return null;
}

function ToolState() {
  const { tools, invokeTool } = useSuperCmdK();
  return <button data-testid="tools" onClick={() => void invokeTool("current_page", {}, { source: "voice" })}>
    {tools.map((tool) => tool.name).join(",")}
  </button>;
}

function CurrentCommands() {
  const { commands, open } = useSuperCmdK();
  return <output data-testid="state">{JSON.stringify({ labels: commands.map((item) => item.label), open })}</output>;
}

describe("React integration", () => {
  it("puts the panel class on Radix content rather than behind the overlay", () => {
    render(
      <SuperCmdKProvider commands={[globalCommand]} open>
        <CommandPalette />
      </SuperCmdKProvider>,
    );

    const panel = document.querySelector("[cmdk-dialog]");
    const overlay = document.querySelector("[cmdk-overlay]");
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains("supercmdk-dialog")).toBe(true);
    expect(overlay?.classList.contains("supercmdk-overlay")).toBe(true);
    expect(screen.getByText("Open globally")).toBeTruthy();
  });

  it("overrides global commands for a mounted page and restores them on unmount", async () => {
    const view = render(
      <SuperCmdKProvider commands={[globalCommand]}>
        <PageCommands />
        <CurrentCommands />
      </SuperCmdKProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("Open on this page"));

    view.rerender(
      <SuperCmdKProvider commands={[globalCommand]}>
        <CurrentCommands />
      </SuperCmdKProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("Open globally"));
  });

  it("exposes provider tools synchronously to descendants", () => {
    const wrapper = ({ children }: PropsWithChildren) => createElement(SuperCmdKProvider, { tools: [globalTool] }, children);
    const { result } = renderHook(() => useSuperCmdK(), { wrapper });
    expect(result.current.tools).toEqual([globalTool]);
  });

  it("preserves externally owned base tools and policy", async () => {
    const authorize = vi.fn(() => false);
    const registry = createToolRegistry({ tools: [globalTool], policy: { authorize } });
    const view = render(
      <SuperCmdKProvider toolRegistry={registry}>
        <ToolState />
      </SuperCmdKProvider>,
    );

    const result = await registry.invokeTool("current_page", {}, { source: "voice" });
    expect(result).toMatchObject({ ok: false, error: { code: "denied" } });
    expect(authorize).toHaveBeenCalledOnce();

    view.unmount();
    expect(registry.getTool("current_page")).toBe(globalTool);
    expect(registry.getPolicy()?.authorize).toBe(authorize);
  });

  it("shares route-scoped tools with non-Agent consumers and restores overrides", async () => {
    const registry = createToolRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const view = render(
      <SuperCmdKProvider tools={[globalTool]} toolRegistry={registry}>
        <PageTools />
        <ToolState />
      </SuperCmdKProvider>,
    );

    await waitFor(() => expect(registry.getTool("current_page")).toBeTruthy());
    expect(await registry.invokeTool("current_page", {}, { source: "voice" }))
      .toMatchObject({ ok: true, value: "page" });

    view.rerender(
      <SuperCmdKProvider tools={[globalTool]} toolRegistry={registry}>
        <ToolState />
      </SuperCmdKProvider>,
    );

    await waitFor(async () => expect(await registry.invokeTool("current_page", {}))
      .toMatchObject({ ok: true, value: "global" }));
    expect(listener).toHaveBeenCalled();
  });

  it("toggles once for Cmd+K and ignores key repeat", () => {
    render(
      <SuperCmdKProvider>
        <CurrentCommands />
      </SuperCmdKProvider>,
    );

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })));
    expect(screen.getByTestId("state").textContent).toContain('"open":true');

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      repeat: true,
      bubbles: true,
    })));
    expect(screen.getByTestId("state").textContent).toContain('"open":true');
  });

  it("warms the Agent during browser idle time without blocking provider render", async () => {
    class WorkerMock {
      static latest: WorkerMock | undefined;
      readonly messages: unknown[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;

      constructor() { WorkerMock.latest = this; }
      postMessage(message: unknown): void { this.messages.push(message); }
      terminate(): void {}
    }

    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    const idleDescriptor = Object.getOwnPropertyDescriptor(window, "requestIdleCallback");
    let idleCallback: (() => void) | undefined;
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: WorkerMock });
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: (callback: () => void) => {
        idleCallback = callback;
        return 1;
      },
    });

    const view = render(
      <SuperCmdKProvider agent={{
        engine: async () => {
          const { NeedleWasmEngine } = await import("../src/agent/needle-wasm-engine");
          return new NeedleWasmEngine({
            glueUrl: "/needle/needle.js",
            wasmUrl: "/needle/needle.wasm",
            modelUrl: "/needle/needle2.cact",
          });
        },
      }}>
        <CurrentCommands />
      </SuperCmdKProvider>,
    );

    try {
      expect(screen.getByTestId("state")).toBeTruthy();
      expect(WorkerMock.latest).toBeUndefined();
      expect(idleCallback).toBeTypeOf("function");

      act(() => idleCallback?.());
      await waitFor(() => expect(WorkerMock.latest?.messages).toContainEqual(expect.objectContaining({ type: "load" })));
    } finally {
      view.unmount();
      if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
      else Reflect.deleteProperty(globalThis, "Worker");
      if (idleDescriptor) Object.defineProperty(window, "requestIdleCallback", idleDescriptor);
      else Reflect.deleteProperty(window, "requestIdleCallback");
    }
  });
});
