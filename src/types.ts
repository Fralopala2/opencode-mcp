export interface Agent {
    name: string;
    description?: string;
    mode: 'subagent' | 'primary' | 'all';
    builtIn?: boolean;
}

export interface Session {
    id: string;
    title?: string;
}

export interface MessageInfo {
    role: string;
    id: string;
    cost?: number;
    tokens?: {
        input: number;
        output: number;
    };
    error?: {
        name?: string;
        message?: string;
        data?: {
            message?: string;
            detail?: string;
            responseBody?: string;
        };
    };
}

export type TextPartInput = {
    type: 'text';
    text: string;
};

export type FilePartInput = {
    type: 'file';
    mime: string;
    filename?: string;
    url: string;
    source?: unknown;
};

export type PromptPart = TextPartInput | FilePartInput;

export type Part =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | {
          type: 'tool';
          tool: string;
          state:
              | { status: 'completed'; title?: string; output: string }
              | { status: 'error'; error: string };
      };

export interface SessionMessage {
    info: MessageInfo;
    parts: Part[];
}

export type ServerEvent = {
    type: string;
    properties?: Record<string, unknown>;
};
