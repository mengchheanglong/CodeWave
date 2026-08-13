/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted for CodeWave from:
 * QwenLM/qwen-code
 * packages/cli/src/nonInteractive/types.ts
 * commit 92f7549bdc684f264ae09dc4a6f8e7398363f53e
 *
 * This keeps the bounded stream-json wire contract that CodeWave currently
 * consumes, while removing direct dependencies on qwen-code-core.
 */

export type SubagentConfig = Record<string, unknown>;
export type McpToolProgressData = Record<string, unknown>;

export interface Annotation {
  type: string;
  value: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  total_tokens?: number;
}

export interface ExtendedUsage extends Usage {
  server_tool_use?: {
    web_search_requests: number;
  };
  service_tier?: string;
  cache_creation?: {
    ephemeral_1h_input_tokens: number;
    ephemeral_5m_input_tokens: number;
  };
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  contextWindow: number;
}

export interface CLIPermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
}

export interface TextBlock {
  type: 'text';
  text: string;
  annotations?: Annotation[];
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
  annotations?: Annotation[];
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
  annotations?: Annotation[];
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  annotations?: Annotation[];
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface APIUserMessage {
  role: 'user';
  content: string | ContentBlock[];
}

export interface APIAssistantMessage {
  id?: string;
  type?: 'message';
  role: 'assistant';
  model?: string;
  content: ContentBlock[];
  stop_reason?: string | null;
  usage?: Usage;
}

export interface CLIUserMessage {
  type: 'user';
  uuid?: string;
  session_id?: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
  options?: Record<string, unknown>;
}

export interface CLIAssistantMessage {
  type: 'assistant';
  uuid?: string;
  session_id?: string;
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;
}

export interface CLISystemMessage {
  type: 'system';
  subtype: string;
  uuid?: string;
  session_id?: string;
  data?: unknown;
  cwd?: string;
  tools?: string[];
  capabilities?: Record<string, unknown>;
}

export interface CLIResultMessageSuccess {
  type: 'result';
  subtype?: 'success';
  uuid?: string;
  session_id?: string;
  is_error: false;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  result: string;
  usage: ExtendedUsage;
  modelUsage?: Record<string, ModelUsage>;
  permission_denials: CLIPermissionDenial[];
  [key: string]: unknown;
}

export interface CLIResultMessageError {
  type: 'result';
  subtype?: 'error_max_turns' | 'error_during_execution';
  uuid?: string;
  session_id?: string;
  is_error: true;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  usage: ExtendedUsage;
  modelUsage?: Record<string, ModelUsage>;
  permission_denials: CLIPermissionDenial[];
  error?: {
    type?: string;
    message: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type CLIResultMessage = CLIResultMessageSuccess | CLIResultMessageError;

export interface MessageStartStreamEvent {
  type: 'message_start';
  message: {
    id?: string;
    role: 'assistant';
    model?: string;
    content: [];
  };
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export type ContentBlockDelta =
  | {
      type: 'text_delta';
      text: string;
    }
  | {
      type: 'thinking_delta';
      thinking: string;
    }
  | {
      type: 'input_json_delta';
      partial_json: string;
    };

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: ContentBlockDelta;
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageStopStreamEvent {
  type: 'message_stop';
}

export interface ToolProgressStreamEvent {
  type: 'tool_progress';
  tool_use_id: string;
  content: McpToolProgressData;
}

export type StreamEvent =
  | MessageStartStreamEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageStopStreamEvent
  | ToolProgressStreamEvent;

export interface CLIPartialAssistantMessage {
  type: 'stream_event';
  uuid?: string;
  session_id?: string;
  event: StreamEvent;
  parent_tool_use_id: string | null;
}

export type PermissionMode = 'default' | 'plan' | 'auto-edit' | 'yolo';

export interface PermissionSuggestion {
  type: 'allow' | 'deny' | 'modify';
  label: string;
  description?: string;
  modifiedInput?: unknown;
}

export interface HookRegistration {
  event: string;
  callback_id: string;
}

export interface SDKMcpServerConfig {
  type: 'sdk';
  name: string;
}

export interface CLIMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  httpUrl?: string;
  headers?: Record<string, string>;
  tcp?: string;
  timeout?: number;
  trust?: boolean;
  description?: string;
  includeTools?: string[];
  excludeTools?: string[];
  extensionName?: string;
}

export interface CLIControlInterruptRequest {
  subtype: 'interrupt';
}

export interface CLIControlPermissionRequest {
  subtype: 'can_use_tool';
  tool_name: string;
  tool_use_id: string;
  input: unknown;
  permission_suggestions: PermissionSuggestion[] | null;
  blocked_path: string | null;
}

export interface CLIControlInitializeRequest {
  subtype: 'initialize';
  hooks?: HookRegistration[] | null;
  sdkMcpServers?: Record<string, Omit<SDKMcpServerConfig, 'instance'>>;
  mcpServers?: Record<string, CLIMcpServerConfig>;
  agents?: SubagentConfig[];
}

export interface CLIControlSetPermissionModeRequest {
  subtype: 'set_permission_mode';
  mode: PermissionMode;
}

export interface CLIHookCallbackRequest {
  subtype: 'hook_callback';
  callback_id: string;
  input: unknown;
  tool_use_id: string | null;
}

export interface CLIControlMcpMessageRequest {
  subtype: 'mcp_message';
  server_name: string;
  message: {
    jsonrpc?: string;
    method: string;
    params?: Record<string, unknown>;
    id?: string | number | null;
  };
}

export interface CLIControlSetModelRequest {
  subtype: 'set_model';
  model: string;
}

export interface CLIControlMcpStatusRequest {
  subtype: 'mcp_server_status';
}

export interface CLIControlSupportedCommandsRequest {
  subtype: 'supported_commands';
}

export type ControlRequestPayload =
  | CLIControlInterruptRequest
  | CLIControlPermissionRequest
  | CLIControlInitializeRequest
  | CLIControlSetPermissionModeRequest
  | CLIHookCallbackRequest
  | CLIControlMcpMessageRequest
  | CLIControlSetModelRequest
  | CLIControlMcpStatusRequest
  | CLIControlSupportedCommandsRequest;

export interface CLIControlRequest {
  type: 'control_request';
  request_id: string;
  request: ControlRequestPayload;
}

export interface PermissionApproval {
  allowed: boolean;
  reason?: string;
  modifiedInput?: unknown;
}

export interface ControlResponse {
  subtype: 'success';
  request_id: string;
  response: unknown;
}

export interface ControlErrorResponse {
  subtype: 'error';
  request_id: string;
  error: string | { message: string; [key: string]: unknown };
}

export interface CLIControlResponse {
  type: 'control_response';
  response: ControlResponse | ControlErrorResponse;
}

export interface ControlCancelRequest {
  type: 'control_cancel_request';
  request_id?: string;
}

export type ControlMessage =
  | CLIControlRequest
  | CLIControlResponse
  | ControlCancelRequest;

export type CLIMessage =
  | CLIUserMessage
  | CLIAssistantMessage
  | CLISystemMessage
  | CLIResultMessage
  | CLIPartialAssistantMessage;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isCLIUserMessage(msg: unknown): msg is CLIUserMessage {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'user' &&
    'message' in msg
  );
}

export function isCLIAssistantMessage(msg: unknown): msg is CLIAssistantMessage {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'assistant' &&
    'message' in msg
  );
}

export function isCLISystemMessage(msg: unknown): msg is CLISystemMessage {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'system' &&
    'subtype' in msg
  );
}

export function isCLIResultMessage(msg: unknown): msg is CLIResultMessage {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'result' &&
    'is_error' in msg
  );
}

export function isCLIPartialAssistantMessage(
  msg: unknown,
): msg is CLIPartialAssistantMessage {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'stream_event' &&
    'event' in msg
  );
}

export function isControlRequest(msg: unknown): msg is CLIControlRequest {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'control_request' &&
    'request_id' in msg &&
    'request' in msg
  );
}

export function isControlResponse(msg: unknown): msg is CLIControlResponse {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'control_response' &&
    'response' in msg
  );
}

export function isControlCancel(msg: unknown): msg is ControlCancelRequest {
  return (
    isObjectRecord(msg) &&
    'type' in msg &&
    msg.type === 'control_cancel_request'
  );
}

export function isTextBlock(block: unknown): block is TextBlock {
  return isObjectRecord(block) && 'type' in block && block.type === 'text';
}

export function isThinkingBlock(block: unknown): block is ThinkingBlock {
  return isObjectRecord(block) && 'type' in block && block.type === 'thinking';
}

export function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return isObjectRecord(block) && 'type' in block && block.type === 'tool_use';
}

export function isToolResultBlock(block: unknown): block is ToolResultBlock {
  return isObjectRecord(block) && 'type' in block && block.type === 'tool_result';
}
