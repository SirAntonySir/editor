import { OperationGraphSchema } from '@/lib/operation-graph-schema';
import { ImageContextSchema } from '@/lib/image-context-schema';
import type { OperationGraph } from '@/types/operation-graph';
import type { ImageContext } from '@/types/image-context';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function createSession(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('image', blob, 'image.jpg');
  const response = await fetch(`${BASE_URL}/api/session`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`/api/session → ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { session_id: string };
  return body.session_id;
}

export async function analyzeImage(sessionId: string): Promise<ImageContext> {
  const raw = await postJson<unknown>('/api/analyze', { session_id: sessionId });
  return ImageContextSchema.parse(raw);
}

export async function generatePanel(sessionId: string, userGoal: string): Promise<OperationGraph> {
  const raw = await postJson<unknown>('/api/panel', { session_id: sessionId, user_goal: userGoal });
  return OperationGraphSchema.parse(raw);
}

export async function refinePanel(
  sessionId: string,
  priorGraphId: string,
  instruction: string,
): Promise<OperationGraph> {
  const raw = await postJson<unknown>('/api/refine', {
    session_id: sessionId,
    prior_graph_id: priorGraphId,
    instruction,
  });
  return OperationGraphSchema.parse(raw);
}
