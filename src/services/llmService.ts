import { ScriptBreakdown } from "../types";

export class LLMService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private proxyType: string;

  constructor(apiKey: string, baseUrl: string, model: string, proxyType: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.proxyType = proxyType;
  }

  async testProxy(): Promise<{ success: boolean; model?: string; error?: string; suggestion?: string }> {
    try {
      const response = await fetch("/api/test-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          proxy_api_key: this.apiKey,
          api_base_url: this.baseUrl,
          proxy_model: this.model,
          proxy_type: this.proxyType
        }),
      });
      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async parseScript(script: string): Promise<ScriptBreakdown> {
    const response = await fetch("/api/parse-script", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        script,
        proxy_api_key: this.apiKey,
        api_base_url: this.baseUrl,
        proxy_model: this.model,
        proxy_type: this.proxyType
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const error = await response.json();
        throw new Error(error.error || "Failed to parse script");
      } else {
        const text = await response.text();
        throw new Error(`Server error (${response.status}): ${text.substring(0, 100)}...`);
      }
    }

    return await response.json() as ScriptBreakdown;
  }
}
