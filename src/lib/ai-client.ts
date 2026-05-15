import { OperationGraphSchema } from '@/lib/operation-graph-schema';
import { ImageContextSchema } from '@/lib/image-context-schema';
import type { OperationGraph } from '@/types/operation-graph';
import type { ImageContext } from '@/types/image-context';
import type { TargetRef, InsertionIntent } from '@/types/ai-target';

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

/**
 * Bind a pre-computed ImageContext to a freshly-created backend session.
 * Used to re-establish a session after page-reload without re-calling Claude.
 *
 * The frontend type uses camelCase keys; the backend Pydantic model uses
 * snake_case. Convert here to match the wire format the backend expects.
 */
export async function pushSessionContext(
  sessionId: string,
  context: ImageContext,
): Promise<void> {
  const body = {
    subjects: context.subjects,
    lighting: context.lighting,
    dominant_tones: context.dominantTones,
    mood: context.mood,
    candidate_regions: context.candidateRegions.map((r) => ({
      label: r.label,
      description: r.description,
      bbox: r.bbox ?? null,
      representative_point: r.representativePoint ?? null,
    })),
    model_name: context.modelName,
    model_version: context.modelVersion,
    generated_at: context.generatedAt,
  };
  await postJson<unknown>(`/api/session/${sessionId}/context`, body);
}

export interface GeneratePanelOptions {
  targetSnapshotPng: Blob;      // PNG/JPEG blob of the target's current pixel state
  targetRef: TargetRef;
  insertionIntent: InsertionIntent;
}

export async function generatePanel(
  sessionId: string,
  userGoal: string,
  opts: GeneratePanelOptions,
): Promise<OperationGraph> {
  const snapshotBase64 = await blobToBase64(opts.targetSnapshotPng);
  const raw = await postJson<unknown>('/api/panel', {
    session_id: sessionId,
    user_goal: userGoal,
    target_snapshot_base64: snapshotBase64,
    target_ref: opts.targetRef,
    insertion_intent: opts.insertionIntent,
  });
  return OperationGraphSchema.parse(raw);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
