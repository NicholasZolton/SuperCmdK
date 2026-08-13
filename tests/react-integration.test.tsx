import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CommandPalette,
  SuperCmdKProvider,
  useCommandChoice,
  useSuperCmdK,
  type CommandChoice,
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
});
