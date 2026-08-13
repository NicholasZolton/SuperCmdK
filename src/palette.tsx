"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { useSuperCmdK } from "./context";
import type { CommandChoice, NeedleRunOptions, NeedleRunResult } from "./types";

export interface CommandPaletteProps {
  placeholder?: string;
  emptyMessage?: ReactNode;
  ariaLabel?: string;
  /** Show the natural-language Needle action when Needle is configured. Defaults to true. */
  needle?: boolean;
  needleLabel?: (query: string) => ReactNode;
  needleRunOptions?: NeedleRunOptions;
  onNeedleResult?: (result: NeedleRunResult) => void;
  onError?: (error: unknown) => void;
  renderCommand?: (command: CommandChoice) => ReactNode;
  className?: string;
  overlayClassName?: string;
}

function shortcutParts(shortcut: CommandChoice["shortcut"]): readonly string[] {
  if (!shortcut) return [];
  return typeof shortcut === "string" ? shortcut.split("+") : shortcut;
}

function defaultCommand(command: CommandChoice): ReactNode {
  return (
    <>
      {command.icon ? <span className="supercmdk-icon" aria-hidden="true">{command.icon}</span> : null}
      <span className="supercmdk-copy">
        <span className="supercmdk-label">{command.label}</span>
        {command.description ? <span className="supercmdk-description">{command.description}</span> : null}
      </span>
      {command.shortcut ? (
        <span className="supercmdk-shortcut" aria-hidden="true">
          {shortcutParts(command.shortcut).map((part, index) => <kbd key={`${part}-${index}`}>{part}</kbd>)}
        </span>
      ) : null}
    </>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

export function CommandPalette({
  placeholder = "Type a command or ask Needle…",
  emptyMessage = "No commands found.",
  ariaLabel = "Command menu",
  needle = true,
  needleLabel = (query) => <>Run <strong>{query}</strong> with Needle</>,
  needleRunOptions,
  onNeedleResult,
  onError,
  renderCommand = defaultCommand,
  className,
  overlayClassName,
}: CommandPaletteProps) {
  const controller = useSuperCmdK();
  const [query, setQuery] = useState("");
  const [runningNeedle, setRunningNeedle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!controller.open) {
      setQuery("");
      setError(null);
    }
  }, [controller.open]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CommandChoice[]>();
    for (const command of controller.commands) {
      const group = command.group ?? "";
      const entries = groups.get(group) ?? [];
      entries.push(command);
      groups.set(group, entries);
    }
    return groups;
  }, [controller.commands]);

  const selectCommand = (command: CommandChoice) => {
    if (command.disabled) return;
    setError(null);
    const closesPalette = command.closeOnSelect !== false;
    if (closesPalette) controller.setOpen(false);
    // Let the close animation paint before user code can occupy the main thread.
    const ready = closesPalette ? afterNextPaint() : Promise.resolve();
    void ready.then(() => command.run({
      query,
      close: () => controller.setOpen(false),
      runNeedle: controller.runNeedle,
    })).catch((caught) => {
      setError(message(caught));
      onError?.(caught);
    });
  };

  const selectNeedle = () => {
    const input = query.trim();
    if (!input || runningNeedle) return;
    setRunningNeedle(true);
    setError(null);
    void controller.runNeedle(input, needleRunOptions).then((result) => {
      onNeedleResult?.(result);
      controller.setOpen(false);
    }).catch((caught) => {
      setError(message(caught));
      onError?.(caught);
    }).finally(() => setRunningNeedle(false));
  };

  const showNeedle = needle && controller.needleEnabled && query.trim().length > 0;

  return (
    <Command.Dialog
      open={controller.open}
      onOpenChange={controller.setOpen}
      label={ariaLabel}
      loop
      className="supercmdk-root"
      contentClassName={["supercmdk-dialog", className].filter(Boolean).join(" ")}
      overlayClassName={["supercmdk-overlay", overlayClassName].filter(Boolean).join(" ")}
    >
      <Command.Input
        className="supercmdk-input"
        placeholder={placeholder}
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <Command.List className="supercmdk-list">
        <Command.Empty className="supercmdk-empty">{showNeedle ? null : emptyMessage}</Command.Empty>
        {[...grouped.entries()].map(([group, commands]) => (
          <Command.Group key={group || "__ungrouped"} heading={group || undefined} className="supercmdk-group">
            {commands.map((command) => (
              <Command.Item
                key={command.id}
                value={command.id}
                keywords={[command.label, command.description ?? "", ...(command.keywords ?? [])]}
                disabled={command.disabled === true}
                onSelect={() => selectCommand(command)}
                className="supercmdk-item"
              >
                {renderCommand(command)}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
        {showNeedle ? (
          <Command.Group heading="Needle" className="supercmdk-group supercmdk-needle-group" forceMount>
            <Command.Item
              value={`needle:${query}`}
              onSelect={selectNeedle}
              disabled={runningNeedle}
              className="supercmdk-item supercmdk-needle-item"
              forceMount
            >
              <span className="supercmdk-needle-mark" aria-hidden="true">✦</span>
              <span className="supercmdk-copy">
                <span className="supercmdk-label">
                  {runningNeedle ? "Needle is working…" : needleLabel(query.trim())}
                </span>
                <span className="supercmdk-description">Runs locally in a Web Worker</span>
              </span>
            </Command.Item>
          </Command.Group>
        ) : null}
        {error ? <div className="supercmdk-error" role="alert">{error}</div> : null}
      </Command.List>
    </Command.Dialog>
  );
}
