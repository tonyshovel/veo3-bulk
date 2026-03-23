import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Helper for Universal LLM calling
  async function callLLM(params: {
    apiKey: string,
    baseUrl: string,
    model: string,
    system?: string,
    prompt: string,
    maxTokens?: number,
    proxyType?: 'openai' | 'anthropic' | 'gemini'
  }) {
    const { apiKey, baseUrl, model, system, prompt, maxTokens, proxyType } = params;
    
    // Default to OpenAI if it's a multi-model proxy, unless specified
    let type = proxyType;
    if (!type) {
      if (baseUrl.includes('anthropic.com')) type = 'anthropic';
      else if (baseUrl.includes('googleapis.com')) type = 'gemini';
      else type = 'openai';
    }

    const commonHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    if (type === 'anthropic') {
      const client = new Anthropic({
        apiKey: apiKey,
        baseURL: baseUrl || undefined,
        defaultHeaders: commonHeaders
      });
      return await client.messages.create({
        model: model,
        max_tokens: maxTokens || 1024,
        system: system,
        messages: [{ role: "user", content: prompt }],
      });
    } else if (type === 'gemini') {
      // Native Gemini REST API
      const cleanBaseUrl = (baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, '');
      const url = `${cleanBaseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          system_instruction: system ? { parts: [{ text: system }] } : undefined,
          generationConfig: {
            maxOutputTokens: maxTokens || 2048,
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${text}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      return {
        model: model,
        content: [{ type: 'text', text: text }]
      };
    } else {
      // OpenAI Compatible
      const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...commonHeaders,
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt }
          ],
          max_tokens: maxTokens || 1024,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const text = await response.text();
        let errorData;
        try { errorData = JSON.parse(text); } catch(e) { errorData = { message: text }; }
        const error: any = new Error(errorData.error?.message || errorData.message || response.statusText);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      // Map OpenAI response to Anthropic-like structure for compatibility with existing code
      return {
        model: data.model,
        content: [{ type: 'text', text: data.choices[0].message.content }]
      };
    }
  }

  // API Route for testing Proxy API
  app.post("/api/test-proxy", async (req, res) => {
    const { proxy_api_key, api_base_url, proxy_model, proxy_type } = req.body;

    const apiKey = proxy_api_key || process.env.CLAUDE_API_KEY;
    const baseUrl = api_base_url || process.env.VITE_API_BASE_URL;

    if (!apiKey) {
      return res.status(400).json({ error: "API Key is not configured." });
    }

    try {
      const response = await callLLM({
        apiKey,
        baseUrl,
        model: proxy_model || (proxy_type === 'gemini' ? "gemini-1.5-flash" : "claude-3-5-sonnet-20240620"),
        prompt: "Hi",
        maxTokens: 10,
        proxyType: proxy_type
      });
      res.json({ success: true, model: response.model });
    } catch (error: any) {
      console.error("Proxy Test Error Details:", {
        message: error.message,
        status: error.status,
        baseUrl: baseUrl,
        model: proxy_model
      });
      
      let suggestion = "Hãy kiểm tra lại API Key, Base URL và Model Name. Đảm bảo bạn đã chọn đúng 'Loại Proxy' (OpenAI hoặc Anthropic).";
      if (error.status === 403) {
        suggestion = "Lỗi 403 Forbidden: Proxy hoặc API từ chối yêu cầu. Hãy thử đổi 'Loại Proxy' sang OpenAI hoặc kiểm tra lại Base URL (thêm /v1).";
      }

      res.status(error.status || 500).json({ 
        error: error.message,
        suggestion: suggestion
      });
    }
  });

  // API Route for Script Parsing via Proxy
  app.post("/api/parse-script", async (req, res) => {
    const { script, proxy_api_key, api_base_url, proxy_model, proxy_type } = req.body;

    const apiKey = proxy_api_key || process.env.CLAUDE_API_KEY;
    const baseUrl = api_base_url || process.env.VITE_API_BASE_URL;

    if (!apiKey) {
      return res.status(500).json({ error: "API Key is not configured. Please set it in Settings." });
    }

    try {
      const response = await callLLM({
        apiKey,
        baseUrl,
        model: proxy_model || (proxy_type === 'gemini' ? "gemini-1.5-flash" : "claude-3-5-sonnet-20240620"),
        maxTokens: 4000,
        system: "Bạn là một chuyên gia phân tích kịch bản phim. Hãy phân tích kịch bản thành 5 cảnh quay, mỗi cảnh 8 giây. Trả về kết quả dưới dạng JSON thuần túy, không có markdown.",
        prompt: `Phân tích kịch bản sau thành 5 cảnh quay. 
            Kịch bản: ${script}
            
            Cấu trúc JSON yêu cầu:
            {
              "scenes": [
                {
                  "context": "Bối cảnh chi tiết",
                  "character": "Mô tả nhân vật trong cảnh này",
                  "action": "Hành động cụ thể",
                  "expression": "Biểu cảm khuôn mặt",
                  "dialogue": "Lời thoại",
                  "intonation": "Ngữ điệu",
                  "emphasis": "Từ ngữ cần nhấn mạnh",
                  "voiceLock": "Khóa giọng để đồng nhất"
                }
              ]
            }`,
        proxyType: proxy_type
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonStr = content.text.replace(/```json|```/g, "").trim();
        try {
          res.json(JSON.parse(jsonStr));
        } catch (parseError: any) {
          console.error("JSON Parse Error:", jsonStr);
          res.status(500).json({ 
            error: "LLM returned invalid JSON format",
            details: parseError.message,
            raw: jsonStr.substring(0, 200)
          });
        }
      } else {
        throw new Error("Unexpected response from LLM");
      }
    } catch (error: any) {
      console.error("Proxy API Error Details:", {
        message: error.message,
        status: error.status,
        baseUrl: baseUrl,
        model: proxy_model
      });
      
      let suggestion = "Hãy kiểm tra lại API Key và Base URL trong phần Cài đặt.";
      if (error.status === 403) {
        suggestion = "Lỗi 403 Forbidden: Proxy hoặc API từ chối yêu cầu. Hãy thử đổi 'Loại Proxy' sang OpenAI.";
      }

      res.status(error.status || 500).json({ 
        error: error.message,
        suggestion: suggestion
      });
    }
  });

  // --- VEO 3 / GEMINI PROXY ROUTES ---
  
  app.post("/api/veo/test", async (req, res) => {
    const { veo_api_key, veo_base_url, veo_model } = req.body;
    const apiKey = veo_api_key || process.env.VITE_GEMINI_API_KEY;
    const baseUrl = veo_base_url || "https://generativelanguage.googleapis.com";
    const model = veo_model || "veo-3.1-fast-generate-preview";

    try {
      let cleanBaseUrl = baseUrl.replace(/\/$/, '');

      // Check if it's the shopaikey.com API
      if (cleanBaseUrl.includes('shopaikey.com')) {
        const url = `${cleanBaseUrl}/generations`;
        const response = await fetch(url, {
          headers: { 
            'Authorization': `Bearer ${apiKey}`
          }
        });
        
        if (response.status === 401) {
          return res.status(401).json({ error: "Invalid API Key for shopaikey.com" });
        }
        
        // Even if it's 404 or 405, if it's not 401, the key is likely valid
        return res.json({ success: true });
      }

      const hasVersion = cleanBaseUrl.includes('/v1') || cleanBaseUrl.includes('/v1beta');
      
      const url = hasVersion 
        ? `${cleanBaseUrl}/models/${model}:generateContent?key=${apiKey}`
        : `${cleanBaseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
      });

      const responseText = await response.text();
      let data: any = {};
      try { data = JSON.parse(responseText); } catch (e) { /* Not JSON */ }
      
      // Nếu Proxy trả về 200 OK thì chắc chắn thành công
      if (response.ok) {
        return res.json({ success: true });
      }

      // Nếu Google trả về lỗi liên quan đến "Method not found" (404/400) 
      // nhưng không phải 503 (Proxy lỗi) thì nghĩa là kết nối đã THÀNH CÔNG.
      // Vì chúng ta đang dùng model Video để gọi lệnh Văn bản để test.
      if (response.status < 500 && (responseText.includes("Method not found") || responseText.includes("not found"))) {
        return res.json({ success: true, note: "Connectivity OK (Method mismatch expected for video models)" });
      }

      res.status(response.status).json({ error: data.error?.message || responseText || `HTTP ${response.status}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/veo/generate", async (req, res) => {
    const { veo_api_key, veo_base_url, veo_model, prompt, image, config } = req.body;
    const apiKey = veo_api_key || process.env.VITE_GEMINI_API_KEY;
    const baseUrl = veo_base_url || "https://generativelanguage.googleapis.com";
    const model = veo_model || "veo-3.1-fast-generate-preview";

    try {
      let cleanBaseUrl = baseUrl.replace(/\/$/, '');
      
      // Check if it's the shopaikey.com API
      if (cleanBaseUrl.includes('shopaikey.com')) {
        const url = `${cleanBaseUrl}/generations`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            prompt,
            model: model.includes('veo') ? model : 'veo3-fast', // Ensure valid model for this API
            images: image ? [image.url || `data:${image.mimeType};base64,${image.imageBytes}`] : [],
            aspect_ratio: config?.aspectRatio || '16:9',
            enhance_prompt: true,
            enable_upsample: true
          })
        });

        const responseText = await response.text();
        let data: any = {};
        try { data = JSON.parse(responseText); } catch (e) { /* Not JSON */ }

        if (!response.ok) {
          return res.status(response.status).json({ 
            error: data.error?.message || responseText || "Failed to start generation",
            status: response.status
          });
        }
        
        // Normalize response for frontend (shopaikey uses task_id, Google uses name)
        return res.json({
          name: data.task_id, // Map task_id to name for frontend consistency
          done: false,
          status: data.status
        });
      }

      // Construct URL carefully for Google/Other proxies
      let url: string;
      if (cleanBaseUrl.includes('googleapis.com')) {
        // Official Google API - always use v1beta for Veo 3.1
        // Use header for API key instead of query param for better compatibility
        url = `${cleanBaseUrl}/v1beta/models/${model}:generateVideos`;
      } else {
        // Proxy - might already have version or different structure
        const hasVersion = cleanBaseUrl.includes('/v1') || cleanBaseUrl.includes('/v1beta');
        url = hasVersion
          ? `${cleanBaseUrl}/models/${model}:generateVideos`
          : `${cleanBaseUrl}/v1beta/models/${model}:generateVideos`;
        
        // If it's a proxy, we might still need the key in the URL if it doesn't support headers
        if (!url.includes('key=')) {
          url += `?key=${apiKey}`;
        }
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          // Some versions/proxies expect 'contents'
          contents: [
            {
              parts: [
                { text: prompt },
                ...(image ? [{ 
                  inlineData: { 
                    data: image.imageBytes, 
                    mimeType: image.mimeType 
                  } 
                }] : [])
              ]
            }
          ],
          // Others expect 'prompt' and 'image' at top level
          prompt,
          ...(image ? { image } : {}),
          config
        })
      });

      const responseText = await response.text();
      let data: any = {};
      try { data = JSON.parse(responseText); } catch (e) { /* Not JSON */ }

      if (!response.ok) {
        console.error("Veo Generate Error:", response.status, responseText);
        const errorMessage = data.error?.message || responseText || "Failed to start generation";
        return res.status(response.status).json({ 
          error: errorMessage,
          status: response.status,
          details: responseText.substring(0, 1000)
        });
      }
      res.json(data);
    } catch (error: any) {
      console.error("Veo Generate Exception:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/veo/status", async (req, res) => {
    const { veo_api_key, veo_base_url, operation_name } = req.body;
    const apiKey = veo_api_key || process.env.VITE_GEMINI_API_KEY;
    const baseUrl = veo_base_url || "https://generativelanguage.googleapis.com";

    try {
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');

      // Check if it's the shopaikey.com API
      if (cleanBaseUrl.includes('shopaikey.com')) {
        const url = `${cleanBaseUrl}/generations/${operation_name}`;
        const response = await fetch(url, {
          headers: { 
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        });

        const responseText = await response.text();
        let data: any = {};
        try { data = JSON.parse(responseText); } catch (e) { /* Not JSON */ }

        if (!response.ok) {
          return res.status(response.status).json({ error: data.error?.message || responseText || "Failed to check status" });
        }

        // Normalize response for frontend
        return res.json({
          name: data.task_id,
          done: data.status === 'completed' || data.status === 'failed',
          response: data.status === 'completed' ? {
            generatedVideos: [{
              video: { uri: data.video_url }
            }]
          } : undefined,
          error: data.status === 'failed' ? { message: data.error || "Generation failed" } : undefined
        });
      }

      const hasVersion = cleanBaseUrl.includes('/v1') || cleanBaseUrl.includes('/v1beta');
      const url = hasVersion
        ? `${cleanBaseUrl}/${operation_name}?key=${apiKey}`
        : `${cleanBaseUrl}/v1beta/${operation_name}?key=${apiKey}`;
      
      const response = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey }
      });

      const responseText = await response.text();
      let data: any = {};
      try { data = JSON.parse(responseText); } catch (e) { /* Not JSON */ }

      if (!response.ok) {
        return res.status(response.status).json({ error: data.error?.message || responseText || "Failed to check status" });
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/veo/download", async (req, res) => {
    const uri = req.query.uri as string;
    const apiKey = req.query.key as string || process.env.VITE_GEMINI_API_KEY;

    if (!uri) return res.status(400).send("Missing URI");

    try {
      const headers: Record<string, string> = {};
      if (uri.includes('shopaikey.com')) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        headers['x-goog-api-key'] = apiKey || "";
      }

      const response = await fetch(uri, { headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Download Proxy Error:", errorText);
        return res.status(response.status).send(errorText);
      }

      // Chuyển tiếp các header quan trọng
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      // Sử dụng stream để truyền dữ liệu hiệu quả, tránh tốn RAM server
      if (response.body) {
        // @ts-ignore - Node fetch body is a ReadableStream in newer versions
        const reader = response.body.getReader();
        
        const stream = new ReadableStream({
          async start(controller) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          }
        });

        // Chuyển đổi Web Stream sang Node Stream để pipe
        const nodeStream = require('stream').Readable.fromWeb(stream);
        nodeStream.pipe(res);
      } else {
        res.status(500).send("No response body from Google");
      }
    } catch (error: any) {
      console.error("Proxy Download Exception:", error);
      res.status(500).send(error.message);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
