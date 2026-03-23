import { Scene } from "../types";

export class VeoService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || "https://generativelanguage.googleapis.com";
  }

  async testVeo3(): Promise<boolean> {
    try {
      const response = await fetch("/api/veo/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          veo_api_key: this.apiKey,
          veo_base_url: this.baseUrl
        }),
      });
      return response.ok;
    } catch (error) {
      console.error("Veo3 Test Error:", error);
      return false;
    }
  }

  async generateVideo(scene: Scene, base64Image?: string): Promise<string> {
    const prompt = `Video of ${scene.character} in ${scene.context}. 
    Action: ${scene.action}. 
    Expression: ${scene.expression}. 
    Style: Cinematic, high quality, consistent character.`;

    // 1. Start generation
    const response = await fetch("/api/veo/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        veo_api_key: this.apiKey,
        veo_base_url: this.baseUrl,
        prompt,
        image: base64Image ? {
          imageBytes: base64Image.split(',')[1],
          mimeType: base64Image.split(';')[0].split(':')[1],
        } : undefined,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to start video generation");
    }

    let operation = await response.json();

    // 2. Poll for completion
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const statusRes = await fetch("/api/veo/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veo_api_key: this.apiKey,
          veo_base_url: this.baseUrl,
          operation_name: operation.name
        })
      });

      if (!statusRes.ok) throw new Error("Failed to check video status");
      operation = await statusRes.json();
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Failed to generate video");

    // 3. Download via proxy to avoid CORS and handle auth
    const videoUrl = `/api/veo/download?uri=${encodeURIComponent(downloadLink)}&key=${encodeURIComponent(this.apiKey)}`;
    
    // We can return the proxy URL directly
    return videoUrl;
  }
}
