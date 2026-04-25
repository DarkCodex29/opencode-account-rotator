/**
 * opencode-account-rotator — TUI Entry Point
 *
 * Registers Solid.js components into OpenCode's TUI via api.slots.register().
 * Reads account-rotator-state.json on a 1s poll interval (same pattern as
 * opencode-subagent-statusline).
 *
 * Export shape: { id, tui } — matches the reference plugin exactly.
 */
interface ToastOptions {
    variant: "info" | "success" | "warning" | "error";
    message: string;
}
interface CommandEntry {
    title: string;
    value: string;
    description?: string;
    category?: string;
    onSelect: () => void;
}
interface SlotContext {
    session_id?: string;
    theme: {
        current: Record<string, string>;
    };
    width?: number;
    columns?: number;
    cols?: number;
}
interface TuiAPI {
    kv: {
        get<T>(key: string, defaultValue: T): T;
        set(key: string, value: unknown): void;
    };
    command: {
        register(factory: () => CommandEntry[]): () => void;
    };
    event: {
        on(event: string, handler: (event: unknown) => void): () => void;
    };
    lifecycle: {
        onDispose(handler: () => void): void;
    };
    slots: {
        register(config: {
            slots: {
                sidebar_content?: (ctx: SlotContext) => unknown;
                home_bottom?: (ctx: SlotContext) => unknown;
            };
        }): void;
    };
    ui: {
        toast(options: ToastOptions): void;
    };
    route: {
        current: {
            name: string;
            params?: Record<string, unknown>;
        };
    };
}
declare const plugin: {
    id: string;
    tui: (api: TuiAPI) => Promise<void>;
};

export { plugin as default };
