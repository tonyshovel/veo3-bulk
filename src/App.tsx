/// <reference types="vite/client" />
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  FileText, 
  Play, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Image as ImageIcon,
  Video as VideoIcon,
  ChevronRight,
  Download,
  Settings,
  X
} from 'lucide-react';
import { LLMService } from './services/llmService';
import { VeoService } from './services/veoService';
import { Scene, ScriptBreakdown, VideoResult } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [script, setScript] = useState('');
  const [characterImage, setCharacterImage] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [breakdown, setBreakdown] = useState<ScriptBreakdown | null>(null);
  const [results, setResults] = useState<VideoResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // API Settings - LLM (Script Analysis)
  const [llmBaseUrl, setLlmBaseUrl] = useState(localStorage.getItem('llm_base_url') || import.meta.env.VITE_API_BASE_URL || 'https://api.shopaikey.com/v1');
  const [llmKey, setLlmKey] = useState(localStorage.getItem('llm_api_key') || '');
  const [llmModel, setLlmModel] = useState(localStorage.getItem('llm_model') || 'claude-3-5-sonnet-20240620');
  const [llmProxyType, setLlmProxyType] = useState<'openai' | 'anthropic'>(localStorage.getItem('llm_proxy_type') as any || 'openai');
  
  // API Settings - Veo 3 (Video Generation)
  const [veoBaseUrl, setVeoBaseUrl] = useState(localStorage.getItem('veo_base_url') || 'https://generativelanguage.googleapis.com');
  const [veoKey, setVeoKey] = useState(localStorage.getItem('veo_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '');
  
  const [testStatus, setTestStatus] = useState<{ llm?: 'testing' | 'success' | 'failed', veo?: 'testing' | 'success' | 'failed' }>({});
  const [llmError, setLlmError] = useState<string | null>(null);
  const [veoError, setVeoError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('llm_base_url', llmBaseUrl);
    localStorage.setItem('llm_api_key', llmKey);
    localStorage.setItem('llm_model', llmModel);
    localStorage.setItem('llm_proxy_type', llmProxyType);
    localStorage.setItem('veo_base_url', veoBaseUrl);
    localStorage.setItem('veo_api_key', veoKey);
  }, [llmBaseUrl, llmKey, llmModel, llmProxyType, veoBaseUrl, veoKey]);

  const handleTestLLM = async () => {
    setTestStatus(prev => ({ ...prev, llm: 'testing' }));
    setLlmError(null);
    const llm = new LLMService(llmKey, llmBaseUrl, llmModel, llmProxyType);
    const result = await llm.testProxy();
    
    if (result.success) {
      setTestStatus(prev => ({ ...prev, llm: 'success' }));
    } else {
      setTestStatus(prev => ({ ...prev, llm: 'failed' }));
      setLlmError(result.error || result.suggestion || "Lỗi kết nối LLM");
    }
  };

  const handleTestVeo = async () => {
    setTestStatus(prev => ({ ...prev, veo: 'testing' }));
    setVeoError(null);
    try {
      const veo = new VeoService(veoKey, veoBaseUrl);
      const success = await veo.testVeo3();
      setTestStatus(prev => ({ ...prev, veo: success ? 'success' : 'failed' }));
      if (!success) setVeoError("Lỗi kết nối Veo 3 (Gemini). Hãy kiểm tra API Key.");
    } catch (err: any) {
      setTestStatus(prev => ({ ...prev, veo: 'failed' }));
      setVeoError(err.message);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCharacterImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const [isBulkMode, setIsBulkMode] = useState(false);

  const [allParsedScenes, setAllParsedScenes] = useState<{ scriptIdx: number; scene: Scene; sceneIdx: number }[]>([]);

  const handleGenerate = async () => {
    if (!script || !characterImage) {
      setError("Vui lòng nhập kịch bản và tải lên ảnh nhân vật.");
      return;
    }

    if (!veoKey) {
      setError("Vui lòng cấu hình Veo 3 API Key trong phần Cài đặt.");
      setShowSettings(true);
      return;
    }

    setError(null);
    setIsParsing(true);
    setResults([]);
    setAllParsedScenes([]);

    try {
      const llm = new LLMService(llmKey, llmBaseUrl, llmModel, llmProxyType);
      const veo = new VeoService(veoKey, veoBaseUrl);
      
      const scripts = isBulkMode ? script.split('---').map(s => s.trim()).filter(s => s) : [script];
      
      // 1. Parse all scripts first
      const parsedScenes: { scriptIdx: number; scene: Scene; sceneIdx: number }[] = [];
      for (let i = 0; i < scripts.length; i++) {
        const parsed = await llm.parseScript(scripts[i]);
        parsed.scenes.forEach((scene, sceneIdx) => {
          parsedScenes.push({ scriptIdx: i, scene, sceneIdx });
        });
      }
      setAllParsedScenes(parsedScenes);

      // 2. Initialize results
      const initialResults: VideoResult[] = parsedScenes.map((_, i) => ({
        sceneIndex: i,
        videoUrl: '',
        status: 'pending'
      }));
      setResults(initialResults);
      setIsParsing(false);
      setIsGenerating(true);

      // 3. Process scenes with concurrency limit
      const CONCURRENCY_LIMIT = 3;
      const queue = [...parsedScenes.entries()];
      const activePromises: Promise<void>[] = [];

      const processNext = async (): Promise<void> => {
        if (queue.length === 0) return;
        
        const [globalIdx, item] = queue.shift()!;
        
        setResults(prev => prev.map((res, idx) => idx === globalIdx ? { ...res, status: 'processing' } : res));
        
        try {
          const videoUrl = await veo.generateVideo(item.scene, characterImage);
          setResults(prev => prev.map((res, idx) => idx === globalIdx ? { ...res, status: 'completed', videoUrl } : res));
        } catch (err: any) {
          console.error(`Error generating scene ${globalIdx}:`, err);
          setResults(prev => prev.map((res, idx) => idx === globalIdx ? { ...res, status: 'failed', error: err.message } : res));
        }

        return processNext();
      };

      for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, queue.length); i++) {
        activePromises.push(processNext());
      }

      await Promise.all(activePromises);

    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi không xác định.");
    } finally {
      setIsParsing(false);
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <VideoIcon className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Veo 3 Bulk Video</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
            >
              <Settings className="w-4 h-4" />
              Cài đặt API
            </button>
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-semibold flex items-center gap-3">
                  <Settings className="w-5 h-5 text-orange-500" />
                  Cấu hình API Riêng biệt
                </h2>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-white/40" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* LLM Section */}
                <div className="space-y-6">
                  <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-orange-500/20 pb-2">1. AI Model (Phân tích)</h3>
                  
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2 font-semibold">LLM API Base URL</label>
                    <input 
                      type="text" 
                      value={llmBaseUrl}
                      onChange={(e) => setLlmBaseUrl(e.target.value)}
                      placeholder="https://api.shopaikey.com/v1"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] uppercase tracking-widest text-white/40 font-semibold">LLM API Key</label>
                      <button 
                        onClick={handleTestLLM}
                        disabled={testStatus.llm === 'testing'}
                        className={cn(
                          "text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-all",
                          testStatus.llm === 'success' ? "border-emerald-500/50 text-emerald-400" :
                          testStatus.llm === 'failed' ? "border-red-500/50 text-red-400" :
                          "border-white/10 text-white/40 hover:text-white/60"
                        )}
                      >
                        {testStatus.llm === 'testing' ? "Đang thử..." : 
                         testStatus.llm === 'success' ? "OK" :
                         testStatus.llm === 'failed' ? "Lỗi" : "Test LLM"}
                      </button>
                    </div>
                    <input 
                      type="password" 
                      value={llmKey}
                      onChange={(e) => setLlmKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all font-mono"
                    />
                    {llmError && (
                      <p className="mt-2 text-[10px] text-red-400/80 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                        {llmError}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2 font-semibold">Loại Proxy</label>
                    <select 
                      value={llmProxyType}
                      onChange={(e) => setLlmProxyType(e.target.value as any)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all"
                    >
                      <option value="openai" className="bg-[#111]">OpenAI Compatible</option>
                      <option value="anthropic" className="bg-[#111]">Anthropic Compatible</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2 font-semibold">Model Name</label>
                    <input 
                      type="text" 
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      placeholder="claude-3-5-sonnet-20240620"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* Veo Section */}
                <div className="space-y-6">
                  <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-orange-500/20 pb-2">2. Veo 3 (Tạo Video)</h3>
                  
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2 font-semibold">Veo 3 Base URL (Tùy chọn)</label>
                    <input 
                      type="text" 
                      value={veoBaseUrl}
                      onChange={(e) => setVeoBaseUrl(e.target.value)}
                      placeholder="Để trống nếu dùng trực tiếp Google"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] uppercase tracking-widest text-white/40 font-semibold">Veo 3 API Key</label>
                      <button 
                        onClick={handleTestVeo}
                        disabled={testStatus.veo === 'testing'}
                        className={cn(
                          "text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-all",
                          testStatus.veo === 'success' ? "border-emerald-500/50 text-emerald-400" :
                          testStatus.veo === 'failed' ? "border-red-500/50 text-red-400" :
                          "border-white/10 text-white/40 hover:text-white/60"
                        )}
                      >
                        {testStatus.veo === 'testing' ? "Đang thử..." : 
                         testStatus.veo === 'success' ? "OK" :
                         testStatus.veo === 'failed' ? "Lỗi" : "Test Veo"}
                      </button>
                    </div>
                    <input 
                      type="password" 
                      value={veoKey}
                      onChange={(e) => setVeoKey(e.target.value)}
                      placeholder="AIza..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all font-mono"
                    />
                    {veoError && (
                      <p className="mt-2 text-[10px] text-red-400/80 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                        {veoError}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-white/10">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-400 text-black font-bold rounded-2xl transition-all text-lg"
                >
                  Lưu & Đóng
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left Column: Inputs */}
          <div className="space-y-8">
            <section>
              <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                1. Nhân vật gốc
              </h2>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative aspect-video rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden group",
                  characterImage ? "border-orange-500/50" : "border-white/10 hover:border-white/20"
                )}
              >
                {characterImage ? (
                  <>
                    <img src={characterImage} alt="Character" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <p className="text-sm font-medium">Thay đổi ảnh</p>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <Upload className="w-8 h-8 text-white/20" />
                    <p className="text-sm text-white/40">Tải lên ảnh nhân vật gốc</p>
                  </div>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  className="hidden" 
                  accept="image/*" 
                />
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  2. Kịch bản chữ
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-white/30">Chế độ hàng loạt</span>
                  <button 
                    onClick={() => setIsBulkMode(!isBulkMode)}
                    className={cn(
                      "w-10 h-5 rounded-full transition-all relative",
                      isBulkMode ? "bg-orange-500" : "bg-white/10"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                      isBulkMode ? "left-6" : "left-1"
                    )} />
                  </button>
                </div>
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder={isBulkMode ? "Nhập nhiều kịch bản, phân cách bằng '---'..." : "Nhập kịch bản của bạn ở đây... Hệ thống sẽ tự động chia thành 5 cảnh quay."}
                className="w-full h-64 bg-white/5 border border-white/10 rounded-2xl p-6 text-lg focus:outline-none focus:border-orange-500/50 transition-all resize-none placeholder:text-white/20"
              />
            </section>

            <button
              onClick={handleGenerate}
              disabled={isParsing || isGenerating}
              className="w-full py-4 bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/20 text-black font-bold rounded-2xl transition-all flex items-center justify-center gap-3 text-lg"
            >
              {isParsing || isGenerating ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  {isParsing ? "Đang phân tích kịch bản..." : "Đang tạo video..."}
                </>
              ) : (
                <>
                  <Play className="w-6 h-6 fill-current" />
                  Bắt đầu tạo Video
                </>
              )}
            </button>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </motion.div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="space-y-8">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest flex items-center gap-2">
                  <ChevronRight className="w-4 h-4" />
                  Tiến độ & Kết quả
                </h2>
                {results.length > 0 && !isGenerating && (
                  <button 
                    onClick={() => { setResults([]); setAllParsedScenes([]); }}
                    className="text-[10px] uppercase tracking-wider text-orange-500 hover:text-orange-400 transition-colors"
                  >
                    Xóa kết quả
                  </button>
                )}
              </div>
              
              {results.length > 0 && (
                <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between text-xs font-mono">
                  <div className="flex gap-4">
                    <span className="text-white/40">Tổng số cảnh: <span className="text-white">{results.length}</span></span>
                    <span className="text-white/40">Hoàn thành: <span className="text-emerald-400">{results.filter(r => r.status === 'completed').length}</span></span>
                  </div>
                  {isGenerating && (
                    <span className="text-orange-500 animate-pulse">Đang xử lý...</span>
                  )}
                </div>
              )}
              
              <div className="space-y-4">
                {results.length === 0 && !isParsing && (
                  <div className="h-64 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-white/20 italic">
                    <p>Chưa có dữ liệu để hiển thị</p>
                  </div>
                )}

                {isParsing && (
                  <div className="space-y-4 animate-pulse">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className="h-24 bg-white/5 rounded-2xl border border-white/10" />
                    ))}
                  </div>
                )}

                <AnimatePresence mode="popLayout">
                  {results.map((result, idx) => {
                    const item = allParsedScenes[idx];
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(idx * 0.05, 1) }}
                        className={cn(
                          "p-6 rounded-2xl border transition-all",
                          result.status === 'completed' ? "bg-white/5 border-white/10" : "bg-black border-white/5"
                        )}
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <span className="text-xs font-mono text-orange-500 mb-1 block">
                              VIDEO {item ? item.scriptIdx + 1 : '?'} - SCENE {item ? item.sceneIdx + 1 : '?'}
                            </span>
                            <h3 className="font-medium text-white/80">
                              {item?.scene.action || "Đang xử lý..."}
                            </h3>
                          </div>
                          <div className="flex items-center gap-2">
                            {result.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-orange-500" />}
                            {result.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                            {result.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                          </div>
                        </div>

                        {result.status === 'completed' && result.videoUrl && (
                          <div className="relative group rounded-xl overflow-hidden bg-black aspect-video">
                            <video 
                              src={result.videoUrl} 
                              controls 
                              className="w-full h-full object-contain"
                            />
                            <a 
                              href={result.videoUrl} 
                              download={`video-${item?.scriptIdx + 1}-scene-${item?.sceneIdx + 1}.mp4`}
                              className="absolute top-4 right-4 p-2 bg-black/60 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-orange-500 hover:text-black"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        )}

                        {result.status === 'failed' && (
                          <p className="text-xs text-red-400 mt-2">{result.error}</p>
                        )}

                        {item?.scene && (
                          <div className="mt-4 grid grid-cols-2 gap-4 text-[10px] uppercase tracking-wider text-white/30 font-mono">
                            <div>
                              <span className="block text-white/10 mb-1">Biểu cảm</span>
                              <span className="text-white/60">{item.scene.expression}</span>
                            </div>
                            <div>
                              <span className="block text-white/10 mb-1">Lời thoại</span>
                              <span className="text-white/60 truncate">{item.scene.dialogue}</span>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 text-center">
        <p className="text-xs text-white/20 uppercase tracking-[0.2em]">
          Powered by Google Veo 3.1 & Gemini 3.1 Pro
        </p>
      </footer>
    </div>
  );
}
