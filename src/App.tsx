import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Image as ImageIcon, User, CheckCircle2, Download, Trash2, Copy, 
  Sparkles, ChevronDown, Video, UploadCloud, Activity, Terminal,
  RefreshCw, ShieldCheck, Zap, Edit3, History, LayoutTemplate,
  Settings, Server, Cpu, Key, X, Globe
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type MediaType = 'image' | 'video' | null;

interface MediaState {
  file: File | null;
  previewUrl: string | null;
  base64Data: string | null;
  type: MediaType;
  dna: string | null;
  isExtracting: boolean;
}

interface HistoryItem {
  id: string;
  image: string;
  baseDna: string;
  targetDna: string;
  resultDna: string;
  timestamp: string;
}

const initialMediaState: MediaState = {
  file: null,
  previewUrl: null,
  base64Data: null,
  type: null,
  dna: null,
  isExtracting: false,
};

interface EngineSettings {
  mode: 'gemini' | 'custom';
  endpoint: string;
  apiKey: string;
  visionModel: string;
  imageModel: string;
}

const defaultSettings: EngineSettings = {
  mode: 'gemini',
  endpoint: 'http://localhost:11434/v1',
  apiKey: '',
  visionModel: 'llava',
  imageModel: 'stable-diffusion'
};

const ASPECT_RATIOS = [
  { label: 'PORTRAIT', value: '9:16', icon: '📱' },
  { label: 'LANDSCAPE', value: '16:9', icon: '🖥️' },
  { label: 'SQUARE', value: '1:1', icon: '⏹️' },
  { label: 'CLASSIC', value: '4:3', icon: '📺' },
];

export default function App() {
  const [settings, setSettings] = useState<EngineSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [baseMedia, setBaseMedia] = useState<MediaState>(initialMediaState);
  const [targetMedia, setTargetMedia] = useState<MediaState>(initialMediaState);
  
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [synthesizedDNA, setSynthesizedDNA] = useState<string | null>(null);
  
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [showRatioMenu, setShowRatioMenu] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const [logs, setLogs] = useState<{time: string, text: string, type: 'info' | 'success' | 'error' | 'warning'}[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const addLog = (text: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setLogs(prev => [...prev, { time, text, type }]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    const saved = localStorage.getItem('ai_snap_settings');
    if (saved) {
      try { setSettings(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  const saveSettings = (newSettings: EngineSettings) => {
    setSettings(newSettings);
    localStorage.setItem('ai_snap_settings', JSON.stringify(newSettings));
    addLog(`SYSTEM: Neural Engine routed to [${newSettings.mode.toUpperCase()}]`, 'warning');
  };

  // Extract a frame from a video file to send to Gemini
  const extractVideoFrame = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      
      video.onloadeddata = () => {
        // Seek to 1 second or middle of the video if shorter
        video.currentTime = Math.min(1, video.duration / 2);
      };
      
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(video.src);
        resolve(base64);
      };
      
      video.onerror = (e) => {
        URL.revokeObjectURL(video.src);
        reject(new Error("Failed to process video file"));
      };
    });
  };

  // Convert image file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const extractDNA = async (base64Image: string, context: 'scene' | 'identity' | 'result') => {
    const base64Data = base64Image.split(',')[1];
    const mimeType = base64Image.split(';')[0].split(':')[1];

    let prompt = "";
    if (context === 'scene') {
      prompt = "Analyze this image/video frame and provide a detailed description of the SCENE. Format as a JSON object with keys: 'suasana', 'pencahayaan', 'latar_belakang', 'warna_dominan', 'waktu', 'properti_tambahan'. Return ONLY valid JSON without markdown formatting.";
    } else if (context === 'identity') {
      prompt = "Analyze this image/video frame and provide a detailed description of the PERSON/SUBJECT. Format as a JSON object with keys: 'gender', 'usia_perkiraan', 'pakaian', 'gaya_rambut', 'aksesoris', 'ekspresi', 'pose'. Return ONLY valid JSON without markdown formatting.";
    } else {
      prompt = "Analyze this synthesized image. Format as a JSON object with keys: 'suasana', 'pencahayaan', 'subjek', 'kualitas_render', 'warna_dominan'. Return ONLY valid JSON without markdown formatting.";
    }

    let responseText = "";

    if (settings.mode === 'gemini') {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: mimeType } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
        }
      });
      responseText = response.text || '';
    } else {
      const res = await fetch(`${settings.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: settings.visionModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        })
      });
      
      if (!res.ok) throw new Error(`Local API Error: ${res.statusText}`);
      const data = await res.json();
      responseText = data.choices[0]?.message?.content || '';
    }
    
    try {
      const parsed = JSON.parse(responseText || '{}');
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      return responseText;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, role: 'base' | 'target') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const previewUrl = URL.createObjectURL(file);
    
    const setMediaState = role === 'base' ? setBaseMedia : setTargetMedia;
    const contextType = role === 'base' ? 'scene' : 'identity';
    const logPrefix = role === 'base' ? '[REF_BASE]' : '[REF_TARGET]';

    setMediaState(prev => ({ ...prev, file, previewUrl, type: isVideo ? 'video' : 'image', isExtracting: true }));
    addLog(`INIT: Processing ${isVideo ? 'video' : 'image'} for ${logPrefix}`, 'info');

    try {
      let base64Data = '';
      if (isVideo) {
        addLog(`PROCESS: Extracting optimal frame from video...`, 'info');
        base64Data = await extractVideoFrame(file);
        addLog(`SUCCESS: Video frame extracted successfully.`, 'success');
      } else {
        base64Data = await fileToBase64(file);
      }

      setMediaState(prev => ({ ...prev, base64Data }));
      
      addLog(`INIT: Neural DNA extraction for ${logPrefix}...`, 'info');
      const dna = await extractDNA(base64Data, contextType);
      
      setMediaState(prev => ({ ...prev, dna, isExtracting: false }));
      addLog(`SUCCESS: DNA mapping complete and cached for ${logPrefix}.`, 'success');

    } catch (error: any) {
      console.error(error);
      setMediaState(prev => ({ ...prev, isExtracting: false }));
      addLog(`ERROR: Failed to process ${logPrefix}. ${error?.message || ''}`, 'error');
    }
  };

  const handleDNAEdit = (role: 'base' | 'target', newDna: string) => {
    const setMediaState = role === 'base' ? setBaseMedia : setTargetMedia;
    setMediaState(prev => ({ ...prev, dna: newDna }));
  };

  const handleSynthesis = async () => {
    if (!baseMedia.dna || !targetMedia.dna) {
      addLog('ERROR: Missing required DNA profiles for synthesis.', 'error');
      return;
    }
    
    setIsSynthesizing(true);
    addLog('INIT: Identity hijacking & DNA substitution protocol started.', 'warning');
    
    try {
      addLog(`SYNTHESIS: Compiling multimodal prompt with ${aspectRatio} ratio...`, 'info');

      const prompt = `You are an expert AI image generator. Create a photorealistic, ultra-high 8k quality image. 
      SCENE & ENVIRONMENT DNA (Strictly follow this lighting and background): ${baseMedia.dna}
      SUBJECT IDENTITY DNA (Strictly follow this person's appearance and outfit): ${targetMedia.dna}
      Ensure seamless integration, realistic shadows, perfect composition, and adhere to the requested aspect ratio.`;
      
      let newImageUrl = "";

      if (settings.mode === 'gemini') {
        addLog('SYNTHESIS: Executing neural rendering engine (gemini-2.5-flash-image)...', 'info');
        const imageResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: prompt }] },
          config: {
            imageConfig: { aspectRatio: aspectRatio }
          }
        });

        let generatedBase64 = null;
        for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            generatedBase64 = part.inlineData.data;
            break;
          }
        }
        if (!generatedBase64) throw new Error("No image data found in the neural response.");
        newImageUrl = `data:image/jpeg;base64,${generatedBase64}`;
      } else {
        addLog(`SYNTHESIS: Executing local rendering engine (${settings.imageModel})...`, 'info');
        
        const sizeMap: Record<string, string> = {
          '9:16': '576x1024', '16:9': '1024x576', '1:1': '1024x1024', '4:3': '1024x768'
        };
        
        const res = await fetch(`${settings.endpoint}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: settings.imageModel,
            prompt: prompt,
            n: 1,
            size: sizeMap[aspectRatio] || '1024x1024',
            response_format: 'b64_json'
          })
        });

        if (!res.ok) throw new Error(`Local API Error: ${res.statusText}`);
        const data = await res.json();
        const b64 = data.data[0]?.b64_json;
        if (!b64) throw new Error("No image data returned from local API.");
        newImageUrl = `data:image/jpeg;base64,${b64}`;
      }

      setResultImage(newImageUrl);
      addLog('SUCCESS: Final 8k render synthesized successfully.', 'success');
        
      addLog('INIT: Extracting synthesized result DNA for verification...', 'info');
      const synthDNA = await extractDNA(newImageUrl, 'result');
      setSynthesizedDNA(synthDNA);
      addLog('SUCCESS: Synthesized DNA mapped and verified.', 'success');

      // Add to history
      const now = new Date();
      setHistory(prev => [{
        id: now.getTime().toString(),
        image: newImageUrl,
        baseDna: baseMedia.dna!,
        targetDna: targetMedia.dna!,
        resultDna: synthDNA,
        timestamp: `${now.getHours()}:${now.getMinutes()}`
      }, ...prev]);

    } catch (error: any) {
      console.error(error);
      addLog(`ERROR: Synthesis pipeline failed. ${error?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const resetAll = () => {
    setBaseMedia(initialMediaState);
    setTargetMedia(initialMediaState);
    setResultImage(null);
    setSynthesizedDNA(null);
    setLogs([]);
    addLog('SYSTEM: All caches cleared. Ready for new input.', 'info');
  };

  const formatJSON = (jsonStr: string | null) => {
    if (!jsonStr) return 'Awaiting data...';
    try {
      return JSON.stringify(JSON.parse(jsonStr), null, 2);
    } catch (e) {
      return jsonStr;
    }
  };

  const copyToClipboard = (text: string | null) => {
    if (text) {
      navigator.clipboard.writeText(text);
      addLog('SYSTEM: DNA copied to clipboard.', 'success');
    }
  };

  const downloadImage = () => {
    if (resultImage) {
      const a = document.createElement('a');
      a.href = resultImage;
      a.download = `AI_SNAP_PRO_${new Date().getTime()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      addLog('SYSTEM: Render downloaded successfully.', 'success');
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    setResultImage(item.image);
    setSynthesizedDNA(item.resultDna);
    addLog(`SYSTEM: Loaded render from session history (${item.timestamp}).`, 'info');
  };

  const MediaPreview = ({ state, title, subtitle, icon: Icon, inputRef, onChange, role }: any) => (
    <div className="bg-[#0a0a0c] border border-[#1f1f22] rounded-[32px] p-5 relative overflow-hidden group transition-all hover:border-blue-500/30 flex flex-col h-full">
      <div className="flex items-center justify-between mb-5 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#121214] border border-[#1f1f22] flex items-center justify-center shadow-inner">
            <Icon className={`w-5 h-5 ${role === 'base' ? 'text-blue-500' : 'text-purple-500'}`} />
          </div>
          <div>
            <h2 className="font-black text-sm tracking-wide text-white">{title}</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mt-0.5">{subtitle}</p>
          </div>
        </div>
        {state.isExtracting ? (
          <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
        ) : (
          <CheckCircle2 className={`w-6 h-6 transition-colors ${state.dna ? 'text-emerald-500' : 'text-[#1f1f22]'}`} />
        )}
      </div>
      
      <div 
        onClick={() => !state.isExtracting && inputRef.current?.click()}
        className={`relative w-full aspect-[16/9] sm:aspect-[9/16] bg-[#050505] rounded-2xl border ${state.previewUrl ? 'border-[#1f1f22]' : 'border-dashed border-[#2a2a30] hover:border-blue-500/50'} overflow-hidden flex items-center justify-center cursor-pointer transition-all shrink-0`}
      >
        {state.previewUrl ? (
          <>
            {state.type === 'video' ? (
              <video src={state.previewUrl} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-90" />
            ) : (
              <img src={state.previewUrl} alt={title} className="w-full h-full object-cover opacity-90" />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
              <span className="bg-black/80 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Replace Media
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-gray-600 transition-colors group-hover:text-blue-400">
            <UploadCloud className="w-10 h-10 mb-4 opacity-50" />
            <span className="text-xs font-bold tracking-widest uppercase">Upload Image / Video</span>
            <span className="text-[10px] text-gray-600 mt-2">Auto-detects format</span>
          </div>
        )}
        <input type="file" ref={inputRef} accept="image/*,video/*" className="hidden" onChange={onChange} />
      </div>

      {/* Editable DNA Preview Overlay */}
      <AnimatePresence>
        {state.dna && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 flex flex-col flex-1"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <Edit3 className="w-3 h-3 text-emerald-500" /> Editable DNA
              </span>
              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(state.dna); }} className="text-gray-500 hover:text-white transition-colors" title="Copy DNA">
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <textarea 
              value={state.dna}
              onChange={(e) => handleDNAEdit(role, e.target.value)}
              className="w-full flex-1 min-h-[120px] bg-[#050505] border border-[#1f1f22] rounded-xl p-3 text-[10px] font-mono text-gray-400 leading-relaxed custom-scrollbar focus:outline-none focus:border-blue-500/50 transition-colors resize-y"
              spellCheck={false}
            />
            <p className="text-[9px] text-gray-600 mt-2 text-right italic">* You can manually tweak this JSON before synthesis</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white font-sans selection:bg-blue-500/30">
      {/* Top Navigation Bar */}
      <nav className="border-b border-white/5 bg-[#050505]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Zap className="text-white w-4 h-4" />
            </div>
            <span className="font-black tracking-widest text-sm">AI SNAP <span className="text-blue-500">PRO</span></span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <button 
                onClick={() => setShowRatioMenu(!showRatioMenu)}
                className="flex items-center gap-2 bg-[#0a0a0c] border border-[#1f1f22] px-4 py-2 rounded-full text-[10px] font-bold tracking-wider text-gray-300 hover:bg-[#121214] transition-colors uppercase"
              >
                <LayoutTemplate className="w-3 h-3 text-blue-500" />
                {ASPECT_RATIOS.find(r => r.value === aspectRatio)?.label} ({aspectRatio})
                <ChevronDown className="w-3 h-3 text-gray-500" />
              </button>
              
              <AnimatePresence>
                {showRatioMenu && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 top-full mt-2 w-48 bg-[#0a0a0c] border border-[#1f1f22] rounded-2xl shadow-2xl overflow-hidden z-50"
                  >
                    {ASPECT_RATIOS.map(ratio => (
                      <button
                        key={ratio.value}
                        onClick={() => { setAspectRatio(ratio.value); setShowRatioMenu(false); }}
                        className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold tracking-widest uppercase transition-colors ${aspectRatio === ratio.value ? 'bg-blue-600/10 text-blue-500' : 'text-gray-400 hover:bg-[#121214] hover:text-white'}`}
                      >
                        <span className="flex items-center gap-2">{ratio.icon} {ratio.label}</span>
                        <span className="text-[10px] opacity-50">{ratio.value}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button onClick={resetAll} className="text-xs font-bold text-gray-400 hover:text-white uppercase tracking-widest flex items-center gap-2 transition-colors">
              <RefreshCw className="w-3 h-3" /> Reset
            </button>
            <button onClick={() => setShowSettings(true)} className="text-xs font-bold text-blue-500 hover:text-blue-400 uppercase tracking-widest flex items-center gap-2 transition-colors ml-2 bg-blue-500/10 px-3 py-1.5 rounded-lg">
              <Settings className="w-4 h-4" /> Engine
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl md:text-4xl font-black italic tracking-wider text-white mb-2">
              REVERSE ENGINEERING<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-500">DNA CLONER</span>
            </h1>
            <p className="text-sm text-gray-400 max-w-xl leading-relaxed">
              Upload base scene and target identity. Edit the extracted DNA JSON to fine-tune your prompt, then synthesize a perfect composition.
            </p>
          </div>
          <div className="flex items-center gap-3 bg-[#0a0a0c] border border-[#1f1f22] px-5 py-3 rounded-2xl">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">System Status</div>
              <div className="text-xs font-bold text-emerald-400">Gemini 2.5 Flash Online</div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_350px] gap-8">
          
          {/* Main Workspace */}
          <div className="space-y-8">
            <div className="grid sm:grid-cols-2 gap-6">
              <MediaPreview 
                state={baseMedia} 
                title="01. BASE REFERENCE" 
                subtitle="Scene & Environment Logic" 
                icon={ImageIcon} 
                inputRef={baseInputRef} 
                onChange={(e: any) => handleFileUpload(e, 'base')} 
                role="base" 
              />
              <MediaPreview 
                state={targetMedia} 
                title="02. TARGET IDENTITY" 
                subtitle="Face & Outfit Source" 
                icon={User} 
                inputRef={targetInputRef} 
                onChange={(e: any) => handleFileUpload(e, 'target')} 
                role="target" 
              />
            </div>

            {/* Action Bar */}
            <div className="bg-[#0a0a0c] border border-[#1f1f22] rounded-3xl p-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-3 px-2">
                <div className={`w-3 h-3 rounded-full ${baseMedia.dna && targetMedia.dna ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-gray-700'}`} />
                <span className="text-xs font-bold tracking-widest uppercase text-gray-400">
                  {baseMedia.dna && targetMedia.dna ? 'Ready for Synthesis' : 'Awaiting DNA Profiles'}
                </span>
              </div>
              <button 
                onClick={handleSynthesis}
                disabled={!baseMedia.dna || !targetMedia.dna || isSynthesizing}
                className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:from-[#121214] disabled:to-[#121214] disabled:text-gray-600 disabled:border-[#1f1f22] border border-transparent text-white font-black rounded-2xl text-sm uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20 disabled:shadow-none flex items-center justify-center gap-3"
              >
                {isSynthesizing ? (
                  <><RefreshCw className="w-5 h-5 animate-spin" /> Processing...</>
                ) : (
                  <><Sparkles className="w-5 h-5" /> Execute Synthesis</>
                )}
              </button>
            </div>

            {/* Result Section */}
            <AnimatePresence>
              {resultImage && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#0a0a0c] border border-[#1f1f22] rounded-[32px] p-6"
                >
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="font-black text-lg tracking-wide text-white">SYNTHESIS RESULT</h2>
                      <p className="text-[10px] text-emerald-500 uppercase tracking-widest font-bold mt-1">8k Photorealistic Render • {aspectRatio}</p>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={downloadImage} className="bg-white hover:bg-gray-200 text-black font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-widest flex items-center gap-2 transition-colors">
                        <Download className="w-4 h-4" /> Download
                      </button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-[1fr_1fr] gap-6">
                    <div className="relative w-full bg-[#050505] rounded-2xl border border-[#1f1f22] overflow-hidden flex items-center justify-center" style={{ aspectRatio: aspectRatio.replace(':', '/') }}>
                      <img src={resultImage} alt="Result" className="w-full h-full object-contain" />
                    </div>
                    
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Result DNA Analysis</span>
                        <button onClick={() => copyToClipboard(synthesizedDNA)} className="text-gray-500 hover:text-white transition-colors">
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="bg-[#050505] border border-[#1f1f22] rounded-2xl p-4 flex-1 overflow-y-auto custom-scrollbar min-h-[300px]">
                        <pre className="text-[11px] font-mono text-emerald-400/80 whitespace-pre-wrap leading-relaxed">
                          {synthesizedDNA}
                        </pre>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Session History */}
            {history.length > 0 && (
              <div className="mt-12">
                <div className="flex items-center gap-2 mb-4 text-gray-400">
                  <History className="w-4 h-4" />
                  <h3 className="text-xs font-bold uppercase tracking-widest">Session History</h3>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
                  {history.map((item) => (
                    <button 
                      key={item.id}
                      onClick={() => loadFromHistory(item)}
                      className="relative w-24 h-24 rounded-xl border border-[#1f1f22] overflow-hidden shrink-0 group hover:border-blue-500 transition-colors"
                    >
                      <img src={item.image} alt="History" className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute bottom-0 inset-x-0 bg-black/80 backdrop-blur text-[9px] font-mono text-center py-1 text-gray-400">
                        {item.timestamp}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar: Terminal */}
          <div className="flex flex-col h-full">
            <div className="bg-[#050505] border border-[#1f1f22] rounded-[32px] p-6 font-mono text-[11px] flex-1 min-h-[500px] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#1f1f22]">
                <div className="flex items-center gap-3 text-gray-400">
                  <Terminal className="w-4 h-4 text-blue-500" />
                  <span className="uppercase tracking-widest font-bold">Neural Terminal</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
                </div>
              </div>
              
              <div className="space-y-3 text-gray-400 flex-1 overflow-y-auto flex flex-col justify-start custom-scrollbar pr-2">
                {logs.length === 0 && (
                  <div className="text-gray-600 italic flex items-center gap-2">
                    <span className="w-2 h-4 bg-blue-500 animate-pulse" /> Awaiting system input...
                  </div>
                )}
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3 leading-relaxed">
                    <span className="text-gray-600 shrink-0">[{log.time}]</span>
                    <span className={
                      log.type === 'success' ? 'text-emerald-400' : 
                      log.type === 'error' ? 'text-red-400' : 
                      log.type === 'warning' ? 'text-yellow-400' :
                      'text-blue-400'
                    }>
                      {log.text}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Settings Modal (Hybrid/Localhost Engine) */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0a0a0c] border border-[#1f1f22] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-[#1f1f22]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <Cpu className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h2 className="font-black text-white tracking-wide">NEURAL ENGINE</h2>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Hybrid Routing Configuration</p>
                  </div>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {/* Mode Selector */}
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setSettings({...settings, mode: 'gemini'})}
                    className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${settings.mode === 'gemini' ? 'bg-blue-600/10 border-blue-500 text-blue-500' : 'bg-[#050505] border-[#1f1f22] text-gray-500 hover:border-gray-700'}`}
                  >
                    <Globe className="w-6 h-6" />
                    <span className="text-xs font-bold tracking-widest uppercase">Cloud (Gemini)</span>
                  </button>
                  <button 
                    onClick={() => setSettings({...settings, mode: 'custom'})}
                    className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${settings.mode === 'custom' ? 'bg-purple-600/10 border-purple-500 text-purple-500' : 'bg-[#050505] border-[#1f1f22] text-gray-500 hover:border-gray-700'}`}
                  >
                    <Server className="w-6 h-6" />
                    <span className="text-xs font-bold tracking-widest uppercase">Local / Custom</span>
                  </button>
                </div>

                {settings.mode === 'custom' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block flex items-center gap-2">
                        <Server className="w-3 h-3" /> API Endpoint (OpenAI Compatible)
                      </label>
                      <input 
                        type="text" 
                        value={settings.endpoint}
                        onChange={(e) => setSettings({...settings, endpoint: e.target.value})}
                        placeholder="http://localhost:11434/v1"
                        className="w-full bg-[#050505] border border-[#1f1f22] rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-purple-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block flex items-center gap-2">
                        <Key className="w-3 h-3" /> API Key (Optional for Localhost)
                      </label>
                      <input 
                        type="password" 
                        value={settings.apiKey}
                        onChange={(e) => setSettings({...settings, apiKey: e.target.value})}
                        placeholder="sk-..."
                        className="w-full bg-[#050505] border border-[#1f1f22] rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-purple-500 transition-colors"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Vision Model ID</label>
                        <input 
                          type="text" 
                          value={settings.visionModel}
                          onChange={(e) => setSettings({...settings, visionModel: e.target.value})}
                          placeholder="llava"
                          className="w-full bg-[#050505] border border-[#1f1f22] rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-purple-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Image Model ID</label>
                        <input 
                          type="text" 
                          value={settings.imageModel}
                          onChange={(e) => setSettings({...settings, imageModel: e.target.value})}
                          placeholder="stable-diffusion"
                          className="w-full bg-[#050505] border border-[#1f1f22] rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-purple-500 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-[10px] text-purple-400 leading-relaxed">
                      <strong>Note:</strong> Ensure your local server (e.g., Ollama, LM Studio) has CORS enabled to accept requests from this web app.
                    </div>
                  </motion.div>
                )}
              </div>
              
              <div className="p-6 border-t border-[#1f1f22] bg-[#050505]">
                <button 
                  onClick={() => { saveSettings(settings); setShowSettings(false); }}
                  className="w-full py-4 bg-white hover:bg-gray-200 text-black font-black rounded-xl text-xs uppercase tracking-widest transition-colors"
                >
                  Save & Apply Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Branding */}
      <footer className="border-t border-white/5 bg-[#050505] py-8 mt-12">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
            <ShieldCheck className="w-4 h-4" /> Enterprise Grade Security • End-to-End Encrypted
          </div>
          <div className="text-xs font-bold tracking-widest uppercase text-gray-400 flex items-center gap-2">
            Created <span className="text-white bg-white/10 px-2 py-1 rounded-md">Bian (7Centz)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
