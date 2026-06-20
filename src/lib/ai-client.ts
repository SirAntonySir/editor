import type { ImageContext } from '@/types/image-context';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

/** Read `response.text()` exactly once and JSON-parse if it looks like
 *  JSON. Response bodies can only be consumed once; without this helper
 *  an error path that logs + a caller that parses would race. */
async function readBodyOnce(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { text, json };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const cached = await readBodyOnce(response);
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${cached.text}`);
  }
  return cached.json as T;
}

export async function createSession(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('image', blob, 'image.jpg');
  const response = await fetch(`${BASE_URL}/api/session`, { method: 'POST', body: form });
  const cached = await readBodyOnce(response);
  if (!response.ok) throw new Error(`/api/session → ${response.status} ${cached.text}`);
  const body = cached.json as { session_id: string };
  return body.session_id;
}

export async function analyzeImage(sessionId: string): Promise<ImageContext> {
  const raw = await postJson<unknown>('/api/analyze', { session_id: sessionId });
  return raw as ImageContext;
}

/**
 * Bind a pre-computed ImageContext to a freshly-created backend session.
 * Used to re-establish a session after page-reload without re-calling Claude.
 *
 * Both frontend and backend now use camelCase keys on the wire (Phase 1 Task 1.1).
 */
export async function pushSessionContext(
  sessionId: string,
  context: ImageContext,
): Promise<void> {
  const body = {
    subjects: context.subjects,
    lighting: context.lighting,
    dominantTones: context.dominantTones,
    mood: context.mood,
    candidateRegions: context.candidateRegions.map((r) => ({
      label: r.label,
      description: r.description,
      bbox: r.bbox ?? null,
      representativePoint: r.representativePoint ?? null,
      paths: r.paths ?? null,
      maskPngBase64: r.maskPngBase64 ?? null,
    })),
    modelName: context.modelName,
    modelVersion: context.modelVersion,
    generatedAt: context.generatedAt,
  };
  await postJson<unknown>(`/api/session/${sessionId}/context`, body);
}

