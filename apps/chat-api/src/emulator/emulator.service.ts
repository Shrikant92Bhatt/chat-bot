import { Response } from 'express';
import { extractMemoryCandidates } from '../memory/extractor';
import { RagRetriever } from '../rag/retriever';
import { performWebSearch } from '../llm/web-search';
import { McpAdapter } from '../mcp/adapter';

export interface EmulatorStepEvent {
  stageId: string;
  stageName: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  durationMs: number;
  inputPayload: any;
  outputPayload: any;
  timestamp: string;
}

export async function runEmulatedPipeline(query: string, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const emit = (event: EmulatorStepEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const startTime = Date.now();

  // Stage 1: Orchestration Entry
  emit({
    stageId: 'orchestration',
    stageName: 'Orchestration & Routing',
    status: 'running',
    durationMs: 0,
    inputPayload: { query },
    outputPayload: { state: 'INITIALIZING_GRAPH', activeNode: 'start_node' },
    timestamp: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 350));
  emit({
    stageId: 'orchestration',
    stageName: 'Orchestration & Routing',
    status: 'completed',
    durationMs: 350,
    inputPayload: { query },
    outputPayload: { targetNodes: ['embedding', 'rag', 'memory', 'context'] },
    timestamp: new Date().toISOString(),
  });

  // Stage 2: Embedding
  const embStart = Date.now();
  emit({
    stageId: 'embedding',
    stageName: 'Vector Embedding Generation',
    status: 'running',
    durationMs: 0,
    inputPayload: { text: query },
    outputPayload: null,
    timestamp: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 200));
  const dummyEmbedding = Array.from({ length: 8 }, () => Number(Math.random().toFixed(4)));
  emit({
    stageId: 'embedding',
    stageName: 'Vector Embedding Generation',
    status: 'completed',
    durationMs: Date.now() - embStart,
    inputPayload: { text: query },
    outputPayload: { dimensions: 768, sampleVector: dummyEmbedding },
    timestamp: new Date().toISOString(),
  });

  // Stage 3: RAG Retrieval & Hybrid Reranking
  const ragStart = Date.now();
  emit({
    stageId: 'rag',
    stageName: 'RAG Retrieval & Hybrid Reranking',
    status: 'running',
    durationMs: 0,
    inputPayload: { query, topK: 5 },
    outputPayload: null,
    timestamp: new Date().toISOString(),
  });
  let ragDocs: any[] = [];
  try {
    const retriever = new RagRetriever();
    ragDocs = await retriever.retrieveContext('admin-user-id', query, 3);
  } catch (e) {
    ragDocs = [{ snippet: 'Sample RAG document payload for emulation', score: 0.92 }];
  }
  emit({
    stageId: 'rag',
    stageName: 'RAG Retrieval & Hybrid Reranking',
    status: 'completed',
    durationMs: Date.now() - ragStart,
    inputPayload: { query, topK: 5 },
    outputPayload: { retrievedCount: ragDocs.length, documents: ragDocs },
    timestamp: new Date().toISOString(),
  });

  // Stage 4: Memory Extraction & Persistence
  const memStart = Date.now();
  emit({
    stageId: 'memory',
    stageName: 'Long-term Memory Inspection',
    status: 'running',
    durationMs: 0,
    inputPayload: { query },
    outputPayload: null,
    timestamp: new Date().toISOString(),
  });
  const extracted = await extractMemoryCandidates(query);
  emit({
    stageId: 'memory',
    stageName: 'Long-term Memory Inspection',
    status: extracted.length > 0 ? 'completed' : 'skipped',
    durationMs: Date.now() - memStart,
    inputPayload: { query },
    outputPayload: { regexGatePassed: extracted.length > 0, memories: extracted },
    timestamp: new Date().toISOString(),
  });

  // Stage 5: Context Assembly
  const ctxStart = Date.now();
  emit({
    stageId: 'context',
    stageName: 'Context Builder & System Prompt',
    status: 'running',
    durationMs: 0,
    inputPayload: { ragDocsCount: ragDocs.length, memoriesCount: extracted.length },
    outputPayload: null,
    timestamp: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 150));
  emit({
    stageId: 'context',
    stageName: 'Context Builder & System Prompt',
    status: 'completed',
    durationMs: Date.now() - ctxStart,
    inputPayload: { ragDocsCount: ragDocs.length, memoriesCount: extracted.length },
    outputPayload: { templateKey: 'chat:v1', assembledPromptLength: 420 },
    timestamp: new Date().toISOString(),
  });

  // Stage 6: Web Search & MCP (Conditional)
  const isWebQuery = /search|web|latest|news|weather/i.test(query);
  const isCalcQuery = /\d+\s*[\+\-\*\/]\s*\d+/.test(query);

  if (isWebQuery) {
    emit({
      stageId: 'web_search',
      stageName: 'Web Search Tool Dispatch',
      status: 'running',
      durationMs: 0,
      inputPayload: { query },
      outputPayload: null,
      timestamp: new Date().toISOString(),
    });
    let searchRes: any = null;
    try {
      searchRes = await performWebSearch(query);
    } catch {
      searchRes = { results: [{ title: 'Emulated Search Result', snippet: 'Information retrieved from web.' }] };
    }
    emit({
      stageId: 'web_search',
      stageName: 'Web Search Tool Dispatch',
      status: 'completed',
      durationMs: 400,
      inputPayload: { query },
      outputPayload: searchRes,
      timestamp: new Date().toISOString(),
    });
  } else {
    emit({
      stageId: 'web_search',
      stageName: 'Web Search Tool Dispatch',
      status: 'skipped',
      durationMs: 0,
      inputPayload: { query },
      outputPayload: { reason: 'Query did not trigger web search criteria' },
      timestamp: new Date().toISOString(),
    });
  }

  if (isCalcQuery) {
    emit({
      stageId: 'mcp',
      stageName: 'MCP Tool & Sandbox Execution',
      status: 'running',
      durationMs: 0,
      inputPayload: { tool: 'system_calculator', query },
      outputPayload: null,
      timestamp: new Date().toISOString(),
    });
    let calcRes: any = null;
    try {
      const adapter = new McpAdapter();
      calcRes = await adapter.executeTool('system_calculator', { expression: query });
    } catch {
      calcRes = { result: 42 };
    }
    emit({
      stageId: 'mcp',
      stageName: 'MCP Tool & Sandbox Execution',
      status: 'completed',
      durationMs: 250,
      inputPayload: { tool: 'system_calculator', query },
      outputPayload: calcRes,
      timestamp: new Date().toISOString(),
    });
  } else {
    emit({
      stageId: 'mcp',
      stageName: 'MCP Tool & Sandbox Execution',
      status: 'skipped',
      durationMs: 0,
      inputPayload: { query },
      outputPayload: { reason: 'No tool call matching conditions' },
      timestamp: new Date().toISOString(),
    });
  }

  // Stage 7: LLM Response Streaming
  emit({
    stageId: 'llm_response',
    stageName: 'LLM Response Token Stream',
    status: 'running',
    durationMs: 0,
    inputPayload: { query },
    outputPayload: null,
    timestamp: new Date().toISOString(),
  });

  const responseText = `[Emulation Stream Complete] Successfully processed query across all pipeline nodes in ${Date.now() - startTime}ms.`;
  const chunks = responseText.split(' ');

  for (const chunk of chunks) {
    emit({
      stageId: 'llm_response',
      stageName: 'LLM Response Token Stream',
      status: 'running',
      durationMs: Date.now() - startTime,
      inputPayload: null,
      outputPayload: { deltaToken: chunk + ' ' },
      timestamp: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 60));
  }

  emit({
    stageId: 'llm_response',
    stageName: 'LLM Response Token Stream',
    status: 'completed',
    durationMs: Date.now() - startTime,
    inputPayload: { query },
    outputPayload: { fullResponse: responseText, totalTokens: chunks.length * 2 },
    timestamp: new Date().toISOString(),
  });

  res.write('data: [DONE]\n\n');
  res.end();
}
