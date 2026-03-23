/// <reference types="vite/client" />
import { GoogleGenAI, Type, VideoGenerationReferenceType } from "@google/genai";
import { Scene, ScriptBreakdown } from "../types";

const GEMINI_MODEL = "gemini-3.1-pro-preview";
const VEO_MODEL = "veo-3.1-fast-generate-preview";

export class GeminiService {
  private ai: GoogleGenAI;
  private apiKey: string;

  private baseUrl?: string;
  private claudeKey?: string;

  constructor(apiKey: string, baseUrl?: string, claudeKey?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.claudeKey = claudeKey;
    this.ai = new GoogleGenAI({ 
      apiKey,
      // @ts-ignore
      baseUrl: baseUrl || import.meta.env.VITE_API_BASE_URL || undefined 
    });
  }

  async testClaude(): Promise<boolean> {
    const response = await fetch("/api/test-claude", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        claude_api_key: this.claudeKey,
        api_base_url: this.baseUrl
      }),
    });
    return response.ok;
  }

  async testVeo3(): Promise<boolean> {
    try {
      await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Hi",
      });
      return true;
    } catch (error) {
      console.error("Veo3 Test Error:", error);
      return false;
    }
  }

  async parseScript(script: string, proxyModel: string, proxyType: string): Promise<ScriptBreakdown> {
    const response = await fetch("/api/parse-script", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        script,
        proxy_api_key: this.claudeKey,
        api_base_url: this.baseUrl,
        proxy_model: proxyModel,
        proxy_type: proxyType
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const error = await response.json();
        throw new Error(error.error || "Failed to parse script with Claude");
      } else {
        const text = await response.text();
        throw new Error(`Server error (${response.status}): ${text.substring(0, 100)}...`);
      }
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(`Expected JSON but got: ${text.substring(0, 100)}...`);
    }

    return await response.json() as ScriptBreakdown;
  }

  async generateVideo(scene: Scene, base64Image?: string): Promise<string> {
    const prompt = `Video of ${scene.character} in ${scene.context}. 
    Action: ${scene.action}. 
    Expression: ${scene.expression}. 
    Style: Cinematic, high quality, consistent character.`;

    let operation = await this.ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: prompt,
      image: base64Image ? {
        imageBytes: base64Image.split(',')[1],
        mimeType: base64Image.split(';')[0].split(':')[1],
      } : undefined,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      }
    });

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await this.ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Failed to generate video");

    // Fetch video with API key
    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: {
        'x-goog-api-key': this.apiKey,
      },
    });

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
}
