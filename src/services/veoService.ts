import { Scene } from "../types";

export class VeoService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl?: string, model?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || "https://generativelanguage.googleapis.com";
    this.model = model || "veo-3.1-fast-generate-preview";
  }

  async testVeo3(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch("/api/veo/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          veo_api_key: this.apiKey,
          veo_base_url: this.baseUrl,
          veo_model: this.model
        }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error };
      }
      
      return { success: true };
    } catch (error: any) {
      console.error("Veo3 Test Error:", error);
      return { success: false, error: error.message };
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
        veo_model: this.model,
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

    const responseText = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Server returned non-JSON response (${response.status}): ${responseText.substring(0, 200)}...`);
    }

    if (!response.ok) {
      const errorMsg = data.error || data.details || "Failed to start video generation";
      throw new Error(`${errorMsg} (HTTP ${response.status})`);
    }

    let operation = data;

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

      const statusText = await statusRes.text();
      let statusData: any = {};
      try {
        statusData = JSON.parse(statusText);
      } catch (e) {
        throw new Error(`Server returned non-JSON status response: ${statusText.substring(0, 100)}...`);
      }

      if (!statusRes.ok) throw new Error(statusData.error || "Failed to check video status");
      operation = statusData;
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Failed to generate video");

    // 3. Download via proxy to avoid CORS and handle auth
    // Trình duyệt không thể tự gửi header 'x-goog-api-key' vào thẻ <video>
    // Nên chúng ta phải dùng server làm proxy trung gian.
    const videoUrl = `/api/veo/download?uri=${encodeURIComponent(downloadLink)}&key=${encodeURIComponent(this.apiKey)}`;
    
    return videoUrl;
  }
}
