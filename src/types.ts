export interface Scene {
  context: string;
  character: string;
  action: string;
  expression: string;
  dialogue: string;
  intonation: string;
  emphasis: string;
  voiceLock: string;
}

export interface ScriptBreakdown {
  scenes: Scene[];
}

export interface VideoResult {
  sceneIndex: number;
  videoUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}
