import type { MCPClient, MCPSession, MCPToolDef, MCPCallResult } from './mcp';

/**
 * Built-in in-process MCP server + client — the offline default and eval/CI fixture (the MCP
 * analogue of MockAdapter / StubMediaAdapter). Exposes one read tool (`echo`) and one low-write
 * tool (`save_note`) so the tiered-execution + confirmation flow has something real to gate on.
 */
export class StubMCPClient implements MCPClient {
  private readonly notes: string[] = [];

  async connect(): Promise<MCPSession> {
    const notes = this.notes;
    return {
      async listTools(): Promise<MCPToolDef[]> {
        return [
          {
            name: 'echo',
            description: 'Echo back the provided text (read-only).',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            annotations: { readOnly: true },
          },
          {
            name: 'save_note',
            description: 'Append a note to the workspace (a write).',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        ];
      },
      async callTool(name: string, args: unknown): Promise<MCPCallResult> {
        const text = String((args as { text?: unknown } | undefined)?.text ?? '');
        if (name === 'echo') return { content: [{ type: 'text', text }] };
        if (name === 'save_note') {
          notes.push(text);
          return { content: [{ type: 'text', text: `saved note #${notes.length}` }] };
        }
        return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
      },
      async close(): Promise<void> {},
    };
  }

  /** Notes written via save_note — for test assertions. */
  savedNotes(): string[] {
    return [...this.notes];
  }
}
