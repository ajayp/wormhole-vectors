const SOLR_URL = process.env.SOLR_URL ?? "http://localhost:8983/solr";

async function handleResponse(res: Response, path: string): Promise<unknown> {
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Solr ${res.status} on ${path}: ${text}`);
  }
  return res.json();
}

export async function solrGet(path: string): Promise<unknown> {
  const res = await fetch(`${SOLR_URL}${path}`);
  return handleResponse(res, path);
}

export async function solrPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SOLR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse(res, path);
}

export async function solrPostForm(path: string, params: [string, string][]): Promise<unknown> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`${SOLR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return handleResponse(res, path);
}
