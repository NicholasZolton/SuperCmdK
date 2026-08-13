import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  CommandPalette,
  SuperCmdKProvider,
  useCommandChoices,
  useSuperCmdK,
  type CommandChoice,
  type AgentRunResult,
  type Tool,
  type ToolInvocationRequest,
  type ToolPolicy,
} from "../../src";
import "../../src/styles.css";
import "./demo.css";

type Page = "overview" | "project";
type LogEntry = { id: number; title: string; detail: string; tone?: "violet" | "green" };
type PendingApproval = {
  request: ToolInvocationRequest;
  resolve: (approved: boolean) => void;
};

const createAgentEngine = async () => {
  const { createNeedleEngine } = await import("../../packages/needle/src");
  return createNeedleEngine();
};

function PageCommands({ page, addLog }: { page: Page; addLog: (title: string, detail: string) => void }) {
  const commands: CommandChoice[] = page === "project" ? [
    {
      id: "copy-project-link",
      label: "Copy project link",
      description: "Copy a shareable Atlas URL",
      group: "This page",
      keywords: ["atlas", "share"],
      run: async () => {
        await navigator.clipboard?.writeText(location.href);
        addLog("Project link copied", "Registered only while the Atlas page is mounted.");
      },
    },
    {
      id: "archive-project",
      label: "Archive Atlas",
      description: "Move this project out of the active workspace",
      group: "This page",
      run: () => addLog("Archive preview", "A real app could ask for confirmation here."),
    },
  ] : [
    {
      id: "refresh-overview",
      label: "Refresh overview",
      description: "Fetch the newest workspace activity",
      group: "This page",
      run: () => addLog("Overview refreshed", "Page-scoped command executed."),
    },
  ];

  useCommandChoices(commands, [page, addLog]);
  return null;
}

function OpenPaletteButton() {
  const { setOpen } = useSuperCmdK();
  return (
    <button className="command-trigger" onClick={() => setOpen(true)}>
      <span className="search-glyph" aria-hidden="true">⌕</span>
      <span>Search commands</span>
      <kbd>⌘ K</kbd>
    </button>
  );
}

function ApprovalDialog({ pending, decide }: {
  pending: PendingApproval | null;
  decide: (approved: boolean) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    denyButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        decide(false);
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        decide(true);
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (buttons.length === 0) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.shiftKey
        ? (index <= 0 ? buttons.length - 1 : index - 1)
        : (index === buttons.length - 1 ? 0 : index + 1);
      event.preventDefault();
      buttons[nextIndex]?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [pending, decide]);

  if (!pending) return null;
  const source = pending.request.context.source === "agent"
    ? "On-device Agent"
    : "Demo control";
  const approvalShortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵";

  return (
    <div className="approval-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) decide(false);
    }}>
      <section
        ref={dialogRef}
        className="approval-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-description"
      >
        <div className="approval-heading">
          <span className="approval-icon" aria-hidden="true">!</span>
          <div>
            <span className="approval-eyebrow">Destructive action</span>
            <h2 id="approval-title">Delete production deployment?</h2>
          </div>
        </div>
        <p id="approval-description">
          This tool is requesting permission to delete the simulated production deployment.
          The demo will not change real resources.
        </p>
        <dl className="approval-details">
          <div><dt>Tool</dt><dd>{pending.request.tool.name}</dd></div>
          <div><dt>Requested by</dt><dd>{source}</dd></div>
          <div><dt>Impact</dt><dd><span className="risk-dot" />Destructive</dd></div>
        </dl>
        <div className="approval-actions">
          <button ref={denyButtonRef} className="approval-deny" onClick={() => decide(false)}>Deny</button>
          <button className="approval-approve" onClick={() => decide(true)}>
            <span>Approve deletion</span>
            <kbd>{approvalShortcut}</kbd>
          </button>
        </div>
        <small className="approval-hint">Esc to deny · {approvalShortcut} to approve</small>
      </section>
    </div>
  );
}

function ApprovalDemoButton({ addLog }: { addLog: (title: string, detail: string, tone?: LogEntry["tone"]) => void }) {
  const { invokeTool } = useSuperCmdK();
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const result = await invokeTool("delete_production_deployment", {}, {
        source: "demo-button",
      });
      if (!result.ok) {
        addLog(
          result.error.code === "denied" ? "Production deletion denied" : "Approval demo failed",
          `${result.error.message}. No resources were changed.`,
        );
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <button className="approval-button" onClick={() => void run()} disabled={running}>
      {running ? "Waiting…" : "Test approval"}
    </button>
  );
}

function AgentChainPanel({ addLog }: { addLog: (title: string, detail: string, tone?: LogEntry["tone"]) => void }) {
  const { preloadAgent, runAgent } = useSuperCmdK();
  const [prompt, setPrompt] = useState("Find Atlas and add a task to review the launch checklist");
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const warmModel = () => void preloadAgent().catch(() => undefined);
  const run = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const next = await runAgent(prompt, { maxSteps: 6 });
      setResult(next);
      addLog(
        "Agent chain complete",
        next.calls.length > 0 ? next.calls.map(({ call }) => call.name).join(" → ") : "No matching tool call",
        "violet",
      );
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(detail);
      addLog("Agent failed", detail);
    } finally {
      setRunning(false);
    }
  };

  const calls = result?.calls ?? [];

  return (
    <article className="panel agent-panel">
      <div className="panel-heading">
        <div><span className="step">02</span><h2>Agent tool chain</h2></div>
        <span className="local-badge">REAL WASM</span>
      </div>
      <p>The 14 MB model warms after page load, then calls JavaScript tools in a Worker. Try “delete production” to exercise approval.</p>
      <textarea
        className="agent-prompt"
        aria-label="Agent prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
      />
      <div className="chain">
        {(calls.length > 0 ? calls : [
          { call: { name: "find_project" }, step: 1 },
          { call: { name: "create_task" }, step: 2 },
        ]).map((entry, index) => (
          <div key={`${entry.call.name}-${index}`} className={calls.length > 0 ? "chain-node done" : "chain-node"}>
            <span>{index + 1}</span>
            <div>
              <strong>{entry.call.name}</strong>
              <small>{calls.length > 0 ? (entry.error ?? JSON.stringify(entry.result)) : (index === 0 ? "find by name" : "uses project ID")}</small>
            </div>
          </div>
        )).reduce<ReactNode[]>((nodes, node, index) => {
          if (index > 0) nodes.push(<div className="chain-line" key={`line-${index}`} />);
          nodes.push(node);
          return nodes;
        }, [])}
      </div>
      {result ? <div className="agent-response">{result.response.response ?? result.response.reasoning ?? `Completed ${result.steps} model step${result.steps === 1 ? "" : "s"}.`}</div> : null}
      {error ? <div className="agent-response error">{error}</div> : null}
      <button
        className="chain-button"
        onPointerEnter={warmModel}
        onFocus={warmModel}
        onClick={() => void run()}
        disabled={running || !prompt.trim()}
      >
        {running ? "Agent is thinking locally…" : result ? "Run it again" : "Run with Agent"}
        <span>→</span>
      </button>
      <small className="model-note">Background warmup never blocks the UI; the first run reuses the loaded Worker whenever it is ready.</small>
    </article>
  );
}

function App() {
  const [page, setPage] = useState<Page>("overview");
  const [isDark, setIsDark] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, title: "Demo ready", detail: "Press ⌘K or Ctrl+K to open the command menu.", tone: "violet" },
  ]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);

  const decideApproval = useCallback((approved: boolean) => {
    const current = pendingApprovalRef.current;
    if (!current) return;
    pendingApprovalRef.current = null;
    setPendingApproval(null);
    current.resolve(approved);
  }, []);

  useEffect(() => () => {
    pendingApprovalRef.current?.resolve(false);
    pendingApprovalRef.current = null;
  }, []);

  const addLog = useCallback((title: string, detail: string, tone?: LogEntry["tone"]) => {
    setLogs((current) => [{ id: Date.now() + Math.random(), title, detail, ...(tone ? { tone } : {}) }, ...current].slice(0, 5));
  }, []);

  const globalCommands = useMemo<CommandChoice[]>(() => [
    {
      id: "go-overview",
      label: "Go to overview",
      description: "Open the workspace dashboard",
      group: "Navigation",
      shortcut: ["G", "O"],
      run: () => setPage("overview"),
    },
    {
      id: "go-project",
      label: "Open project Atlas",
      description: "Jump to the active launch project",
      group: "Navigation",
      shortcut: ["G", "P"],
      keywords: ["atlas", "launch"],
      run: () => setPage("project"),
    },
    {
      id: "toggle-theme",
      label: "Toggle appearance",
      description: "Switch between graphite and paper",
      group: "Workspace",
      shortcut: ["⌘", "⇧", "L"],
      run: () => setIsDark((current) => !current),
    },
    {
      id: "create-project",
      label: "Create a new project",
      description: "Start from a clean workspace",
      group: "Workspace",
      priority: 10,
      run: () => addLog("New project", "Global command selected from the palette.", "green"),
    },
  ], [addLog]);

  const tools = useMemo<Tool[]>(() => [
    {
      name: "find_project",
      description: "Find a project by its human-readable name. Use this before another tool needs a project ID.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Project name from the user's request" } },
        required: ["name"],
      },
      execute: ({ name }) => {
        const requested = String(name).toLowerCase();
        if (!"atlas".includes(requested) && !requested.includes("atlas")) return { error: "No project found" };
        return { id: "atlas-42", name: "Atlas", status: "active" };
      },
    },
    {
      name: "create_task",
      description: "Create a task in a project. Requires the exact project ID returned by find_project.",
      annotations: { destructive: false, idempotent: false },
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Exact project ID returned by find_project" },
          title: { type: "string", description: "Concise task title requested by the user" },
        },
        required: ["projectId", "title"],
      },
      execute: ({ projectId, title }) => {
        // The engine may schedule dependent calls in the same turn. This demo accepts the
        // human-readable Atlas alias while the lookup result is fed back to the model.
        const resolvedProjectId = String(projectId).toLowerCase() === "atlas" ? "atlas-42" : String(projectId);
        const task = {
          id: `task-${Math.floor(Math.random() * 900 + 100)}`,
          projectId: resolvedProjectId,
          title,
          created: true,
        };
        addLog("Task created", `${String(title)} in ${resolvedProjectId}`, "green");
        return task;
      },
    },
    {
      name: "delete_production_deployment",
      description: "Delete the simulated production deployment. Use only when the user explicitly asks to delete production.",
      annotations: {
        destructive: true,
        idempotent: false,
        requiresConfirmation: true,
      },
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => {
        addLog(
          "Production deletion simulated",
          "Approval granted; the destructive tool ran without changing real resources.",
          "green",
        );
        return { deleted: true, simulated: true, environment: "production" };
      },
    },
  ], [addLog]);

  const toolPolicy = useMemo<ToolPolicy>(() => ({
    confirm: (request) => new Promise<boolean>((resolve) => {
      pendingApprovalRef.current?.resolve(false);
      const pending = { request, resolve };
      pendingApprovalRef.current = pending;
      setPendingApproval(pending);
    }),
  }), []);

  return (
    <div className={isDark ? "demo dark" : "demo light"}>
      <SuperCmdKProvider
        commands={globalCommands}
        tools={tools}
        toolPolicy={toolPolicy}
        agent={{
          engine: createAgentEngine,
          systemPrompt: () => `date: ${new Date().toISOString()}; locale: en-US; device: desktop`,
        }}
      >
        <PageCommands page={page} addLog={addLog} />
        <header className="topbar">
          <a className="brand" href="#" aria-label="SuperCmdK home">
            <span className="brand-mark">S</span>
            <span>SuperCmdK</span>
            <span className="version">v0.3</span>
          </a>
          <OpenPaletteButton />
          <a className="github-link" href="https://github.com/NicholasZolton/SuperCmdK" target="_blank" rel="noreferrer">GitHub ↗</a>
        </header>

        <main>
          <nav className="page-tabs" aria-label="Demo pages">
            <button data-active={page === "overview"} onClick={() => setPage("overview")}>Overview</button>
            <button data-active={page === "project"} onClick={() => setPage("project")}>Project Atlas</button>
          </nav>

          <section className="hero">
            <p className="eyebrow"><span /> COMMANDS, WHERE THEY BELONG</p>
            <h1>One menu.<br /><em>Every action.</em></h1>
            <p className="lede">
              Register choices globally or let each route contribute its own. Then give the Agent tools to carry work across steps—entirely on device.
            </p>
            <div className="hero-actions">
              <OpenPaletteButton />
              <span>Try “Atlas,” “appearance,” or “delete production”</span>
            </div>
          </section>

          <section className="demo-grid">
            <article className="panel scope-panel">
              <div className="panel-heading">
                <div><span className="step">01</span><h2>Scoped commands</h2></div>
                <span className="live-dot">LIVE</span>
              </div>
              <p>Switch pages and open the palette. The violet commands mount and unmount with their route.</p>
              <div className="scope-stack">
                <div className="scope-row global-scope">
                  <span className="scope-icon">◎</span>
                  <div><strong>Global scope</strong><small>4 commands · always available</small></div>
                  <span className="status">Mounted</span>
                </div>
                <div className="scope-connector" />
                <div className="scope-row page-scope">
                  <span className="scope-icon">↳</span>
                  <div><strong>{page === "project" ? "Project Atlas" : "Overview"}</strong><small>{page === "project" ? "2" : "1"} page command{page === "project" ? "s" : ""}</small></div>
                  <span className="status">Mounted</span>
                </div>
              </div>
              <div className="approval-demo">
                <div>
                  <strong>Destructive tool policy</strong>
                  <small>Fake production deletion · approval required</small>
                </div>
                <ApprovalDemoButton addLog={addLog} />
              </div>
            </article>

            <AgentChainPanel addLog={addLog} />
          </section>

          <section className="activity">
            <div className="activity-title"><span>Recent activity</span><span>Local demo state</span></div>
            {logs.map((log) => (
              <div className="activity-row" key={log.id}>
                <span className={`activity-mark ${log.tone ?? ""}`} />
                <div><strong>{log.title}</strong><small>{log.detail}</small></div>
                <time>now</time>
              </div>
            ))}
          </section>
        </main>

        <footer><span>Built on cmdk</span><span>Agent powered by Needle · no cloud required</span></footer>
        <CommandPalette
          onAgentResult={(result) => addLog(
            "Agent command complete",
            result.calls.map(({ call, error }) => `${call.name}${error ? " (denied)" : ""}`).join(" → ") || "No matching tool",
            "violet",
          )}
          onError={(error) => addLog("Command failed", String(error))}
        />
        <ApprovalDialog pending={pendingApproval} decide={decideApproval} />
      </SuperCmdKProvider>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
