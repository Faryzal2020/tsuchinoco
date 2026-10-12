// Thin JotForm REST client. Docs: https://api.jotform.com/docs/
export interface JotformQuestion { qid: string; name: string; text: string; type: string; order: string }
export interface JotformSubmission {
  id: string;
  created_at: string; // "YYYY-MM-DD HH:mm:ss"
  status: string;
  answers: Record<string, { name: string; text: string; type: string; answer?: unknown }>;
}

export class Jotform {
  constructor(private apiKey: string, private base = 'https://api.jotform.com') {}

  private async call<T>(method: string, path: string, params?: Record<string, string>): Promise<T> {
    const url = `${this.base}${path}`;
    const init: RequestInit = { method, headers: { APIKEY: this.apiKey } };
    if (params) {
      init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = new URLSearchParams(params).toString();
    }
    const res = await fetch(url, init);
    const json = (await res.json()) as { responseCode: number; message?: string; content: T };
    if (!res.ok || json.responseCode >= 400) throw new Error(`JotForm ${method} ${path}: ${json.message ?? res.statusText}`);
    return json.content;
  }

  user() { return this.call<{ username: string; email: string }>('GET', '/user'); }

  createForm(params: Record<string, string>) { return this.call<{ id: string; url: string }>('POST', '/form', params); }

  getQuestions(formId: string) { return this.call<Record<string, JotformQuestion>>('GET', `/form/${formId}/questions`); }

  addQuestions(formId: string, params: Record<string, string>) { return this.call<unknown>('PUT', `/form/${formId}/questions`, params); }

  deleteQuestion(formId: string, qid: string) { return this.call<unknown>('DELETE', `/form/${formId}/question/${qid}`); }

  setProperties(formId: string, props: Record<string, string>) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) params[`properties[${k}]`] = v;
    return this.call<unknown>('POST', `/form/${formId}/properties`, params);
  }

  addWebhook(formId: string, webhookURL: string) { return this.call<unknown>('POST', `/form/${formId}/webhooks`, { webhookURL }); }

  getWebhooks(formId: string) { return this.call<Record<string, string>>('GET', `/form/${formId}/webhooks`); }

  getSubmission(id: string) { return this.call<JotformSubmission>('GET', `/submission/${id}`); }

  async allSubmissions(formId: string): Promise<JotformSubmission[]> {
    const out: JotformSubmission[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await this.call<JotformSubmission[]>('GET', `/form/${formId}/submissions?limit=1000&offset=${offset}&filter=${encodeURIComponent(JSON.stringify({ 'status:ne': 'DELETED' }))}`);
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }
}

/** Build the questions[...] params for a list of question specs. */
export function questionParams(questions: Record<string, string>[], startIndex = 0): Record<string, string> {
  const params: Record<string, string> = {};
  questions.forEach((q, i) => {
    for (const [k, v] of Object.entries(q)) params[`questions[${startIndex + i}][${k}]`] = v;
  });
  return params;
}
