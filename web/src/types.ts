export type ProcessKind = "service" | "task";
export type ProcessState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed";
export type RunState =
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed"
  | "canceled"
  | "interrupted";

export type Command = {
  argv?: string[];
  shell?: string;
};
export type Port = {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: "http" | "https" | "tcp";
  path?: string;
};

export type Process = {
  id: string;
  selector: string;
  label: string;
  tags: string[];
  kind: ProcessKind;
  state: ProcessState;
  source: {
    kind: string;
    path?: string;
    key?: string;
  };
  command: Command;
  cwd: string;
  env: Record<string, string>;
  ports: Port[];
  created_at: string;
  updated_at: string;
};

export type ProcessSnapshot = Omit<
  Process,
  "selector" | "state" | "created_at" | "updated_at"
>;

export type Run = {
  id: string;
  process_id?: string;
  process: ProcessSnapshot;
  state: RunState;
  pid?: number;
  started_at: string;
  ended_at?: string;
  exit_code?: number;
  error?: string;
  log_path: string;
};

export type LogRecord = {
  seq: number;
  time: string;
  stream: "stdout" | "stderr";
  text: string;
  partial: boolean;
};

export type APIError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
