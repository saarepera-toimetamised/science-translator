'use client';  
  
import { useState, useEffect } from 'react';  
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';  
import { Input } from '@/components/ui/input';  
import { Button } from '@/components/ui/button';  
import { Textarea } from '@/components/ui/textarea';  
import { Badge } from '@/components/ui/badge';  
import { Progress } from '@/components/ui/progress';  
import { Alert, AlertDescription } from '@/components/ui/alert';  
import { Download, Globe, Loader2, FileText, AlertCircle, CheckCircle, ExternalLink, Info } from 'lucide-react';  
  
type TranslationStatus = 'idle' | 'fetching' | 'translating' | 'generating' | 'complete' | 'error' | 'awaiting_input';  
  
interface Message {  
  type: 'system' | 'user' | 'assistant';  
  content: string;  
  id: string;  
}  
  
export default function TranslatorUI() {  
  const [urls, setUrls] = useState('');  
  const [apiKey, setApiKey] = useState('');  
  const [gemPrompt, setGemPrompt] = useState('');  
  const [customPrompt, setCustomPrompt] = useState('');  
  const [status, setStatus] = useState<TranslationStatus>('idle');  
  const [progress, setProgress] = useState(0);  
  const [statusMessage, setStatusMessage] = useState('');  
  const [currentArticle, setCurrentArticle] = useState('');  
  const [messages, setMessages] = useState<Message[]>([]);  
  const [userInput, setUserInput] = useState('');  
  const [translationId, setTranslationId] = useState<string | null>(null);  
  const [showGemPrompt, setShowGemPrompt] = useState(false);  
  
  useEffect(() => {  
    const savedApiKey = localStorage.getItem('gemini_api_key');  
    const savedGemPrompt = localStorage.getItem('gem_prompt');  
    if (savedApiKey) setApiKey(savedApiKey);  
    if (savedGemPrompt) setGemPrompt(savedGemPrompt);  
  }, []);  
  
  useEffect(() => {  
    if (apiKey) localStorage.setItem('gemini_api_key', apiKey);  
  }, [apiKey]);  
  
  useEffect(() => {  
    if (gemPrompt) localStorage.setItem('gem_prompt', gemPrompt);  
  }, [gemPrompt]);  
  
  const parseArticleEntries = (text: string) => {  
    const lines = text.split('\n');  
    const entries: Array<{ estonianTitle?: string; url: string }> = [];  
      
    let currentEstonianTitle = '';  
      
    for (let i = 0; i < lines.length; i++) {  
      const line = lines[i].trim();  
        
      if (!line) continue;  
        
      const urlMatch = line.match(/https?:\/\/[^\s]+/);  
        
      if (urlMatch) {  
        const url = urlMatch[0].replace(/[⁦⁩]/g, '');  
        entries.push({  
          estonianTitle: currentEstonianTitle || undefined,  
          url: url  
        });  
        currentEstonianTitle = '';  
      } else if (!line.startsWith('http') && lines[i + 1]?.includes('http')) {  
        currentEstonianTitle = line;  
      }  
    }  
      
    return entries;  
  };  
  
  const handleTranslate = async () => {  
    const articleEntries = parseArticleEntries(urls);  
      
    if (articleEntries.length === 0 || !apiKey) {  
      setStatus('error');  
      setStatusMessage('Please provide at least one article and your API key');  
      return;  
    }  
  
    setStatus('fetching');  
    setProgress(10);  
    setStatusMessage(`Fetching ${articleEntries.length} article${articleEntries.length > 1 ? 's' : ''}...`);  
    setCurrentArticle('');  
    setMessages([]);  
  
    try {  
      const response = await fetch('/api/translate', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({   
          articleEntries,   
          apiKey,   
          gemPrompt,  
          customPrompt   
        }),  
      });  
  
      const data = await response.json();  
  
      if (!response.ok) {  
        throw new Error(data.error || 'Translation failed');  
      }  
  
      if (data.needsInput) {  
        setStatus('awaiting_input');  
        setTranslationId(data.translationId);  
        setMessages([{ type: 'assistant', content: data.question, id: `msg-${Date.now()}` }]);  
        setProgress(50);  
        setStatusMessage('Waiting for your input...');  
      } else if (data.complete) {  
        setStatus('complete');  
        setProgress(100);  
        setStatusMessage('Translation complete!');  
          
        const blob = new Blob([Buffer.from(data.docx, 'base64')], {  
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'  
        });  
        const downloadUrl = window.URL.createObjectURL(blob);  
        const a = document.createElement('a');  
        a.href = downloadUrl;  
        a.download = `translation_${Date.now()}.docx`;  
        a.click();  
        window.URL.revokeObjectURL(downloadUrl);  
      }  
    } catch (error) {  
      setStatus('error');  
      setStatusMessage(error instanceof Error ? error.message : 'An error occurred');  
    }  
  };  
  
  const handleUserResponse = async () => {  
    if (!userInput.trim() || !translationId) return;  
  
    setMessages([...messages, { type: 'user', content: userInput, id: `msg-${Date.now()}` }]);  
    setStatus('translating');  
    setStatusMessage('Processing your input...');  
    setUserInput('');  
  
    try {  
      const response = await fetch('/api/translate', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({  
          translationId,  
          userInput,  
          apiKey,  
        }),  
      });  
  
      const data = await response.json();  
  
      if (!response.ok) {  
        throw new Error(data.error || 'Translation failed');  
      }  
  
      if (data.needsInput) {  
        setStatus('awaiting_input');  
        setMessages(prev => [...prev, { type: 'assistant', content: data.question, id: `msg-${Date.now()}` }]);  
        setProgress(data.progress || 60);  
        setStatusMessage('Waiting for your input...');  
      } else if (data.complete) {  
        setStatus('complete');  
        setProgress(100);  
        setStatusMessage('Translation complete!');  
          
        const blob = new Blob([Buffer.from(data.docx, 'base64')], {  
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'  
        });  
        const downloadUrl = window.URL.createObjectURL(blob);  
        const a = document.createElement('a');  
        a.href = downloadUrl;  
        a.download = `translation_${Date.now()}.docx`;  
        a.click();  
        window.URL.revokeObjectURL(downloadUrl);  
      }  
    } catch (error) {  
      setStatus('error');  
      setStatusMessage(error instanceof Error ? error.message : 'An error occurred');  
    }  
  };  
  
  const getStatusBadge = () => {  
    switch (status) {  
      case 'idle':  
        return <Badge variant="secondary">Ready</Badge>;  
      case 'fetching':  
        return <Badge className="bg-blue-500"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Fetching</Badge>;  
      case 'translating':  
        return <Badge className="bg-purple-500"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Translating</Badge>;  
      case 'generating':  
        return <Badge className="bg-indigo-500"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Generating</Badge>;  
      case 'awaiting_input':  
        return <Badge className="bg-amber-500"><AlertCircle className="w-3 h-3 mr-1" /> Needs Input</Badge>;  
      case 'complete':  
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" /> Complete</Badge>;  
      case 'error':  
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" /> Error</Badge>;  
    }  
  };  
  
  return (  
    <div className="container mx-auto px-4 py-12 max-w-5xl">  
      <div className="text-center mb-10">  
        <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">  
          Science Article Translator  
        </h1>  
        <p className="text-lg text-slate-700">  
          High-end English to Estonian translation powered by Gemini 2.5 Pro  
        </p>  
        <p className="text-sm text-slate-500 mt-2">  
          Professional AI-powered translation for scientific articles and research papers  
        </p>  
      </div>  
  
      <Card className="shadow-2xl border-slate-200 hover:shadow-3xl transition-shadow duration-300">  
        <CardHeader>  
          <CardTitle className="flex items-center gap-2">  
            <Globe className="w-6 h-6 text-blue-600" />  
            Configuration  
          </CardTitle>  
          <CardDescription>  
            Enter the article URL and your Gemini API key to begin translation  
          </CardDescription>  
        </CardHeader>  
        <CardContent className="space-y-5">  
          <div className="space-y-2">  
            <label className="text-sm font-medium text-slate-700">Articles to Translate</label>  
            <Textarea  
              placeholder="Hüljes näeb oma nutikate vuntsidega kala kavalused läbi&#10;https://phys.org/news/2025-09-sensitive-whiskers-key-foiling-fish.html&#10;Seal's sensitive whiskers hold key to foiling fish escapes...&#10;&#10;Teadlased avaldasid uue uuringu tulemused&#10;https://www.nature.com/articles/example&#10;Scientists revealed new research findings...&#10;&#10;Or simply paste URLs:&#10;https://arxiv.org/abs/example"  
              value={urls}  
              onChange={(e) => setUrls(e.target.value)}  
              className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:border-slate-400 min-h-[160px] text-sm"  
              rows={8}  
            />  
            <p className="text-xs text-slate-500">  
              <Info className="w-3 h-3 inline mr-1" />  
              Paste articles in this format: <strong>Your Estonian headline</strong> → <strong>URL</strong> → Original text snippet (optional)  
            </p>  
            <p className="text-xs text-slate-500 ml-4">  
              Or just paste URLs (one per line) - the app will extract titles automatically  
            </p>  
          </div>  
  
          <div className="space-y-2">  
            <label className="text-sm font-medium text-slate-700">Gemini API Key</label>  
            <Input  
              type="password"  
              placeholder="Enter your Gemini API key"  
              value={apiKey}  
              onChange={(e) => setApiKey(e.target.value)}  
              className="font-mono transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:border-slate-400"  
            />  
            <p className="text-xs text-slate-500 flex items-center gap-1">  
              <Info className="w-3 h-3" />  
              Get your free API key from{' '}  
              <a   
                href="https://aistudio.google.com/apikey"   
                target="_blank"   
                rel="noopener noreferrer"  
                className="text-blue-600 hover:text-blue-700 underline inline-flex items-center gap-0.5"  
              >  
                Google AI Studio  
                <ExternalLink className="w-3 h-3" />  
              </a>  
            </p>  
          </div>  
  
          <div className="space-y-2 border-t pt-4">  
            <button  
              type="button"  
              onClick={() => setShowGemPrompt(!showGemPrompt)}  
              className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"  
            >  
              <span className="text-lg">{showGemPrompt ? '▼' : '▶'}</span>  
              Your Gem Prompt (Recommended)  
              <Badge variant="secondary" className="ml-auto">Saved Locally</Badge>  
            </button>  
            {showGemPrompt && (  
              <div className="space-y-2 pt-2">  
                <Textarea  
                  placeholder="Paste your complete Gemini Gem prompt here...&#10;&#10;Example:&#10;You are a specialized translator for converting scientific articles from English into Estonian. You make no mistakes...&#10;&#10;Rules for Translation:&#10;- Always use third person&#10;- Preserve hyperlinks&#10;- Convert units to European...&#10;&#10;[Your full prompt with all rules and instructions]"  
                  value={gemPrompt}  
                  onChange={(e) => setGemPrompt(e.target.value)}  
                  className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:border-slate-400 min-h-[200px] text-sm font-mono"  
                  rows={10}  
                />  
                <div className="space-y-1">  
                  <p className="text-xs text-slate-500 flex items-center gap-1">  
                    <Info className="w-3 h-3" />  
                    Paste your complete, proven Gemini Gem prompt here (all rules and instructions)  
                  </p>  
                  <p className="text-xs text-slate-500 ml-4">  
                    This ensures consistent translation quality matching your Gem's output  
                  </p>  
                </div>  
              </div>  
            )}  
          </div>  
  
          <div className="space-y-2">  
            <label className="text-sm font-medium text-slate-700">  
              Custom Instructions <span className="text-slate-400 font-normal">(Optional)</span>  
            </label>  
            <Textarea  
              placeholder="Add any specific translation instructions or context..."  
              value={customPrompt}  
              onChange={(e) => setCustomPrompt(e.target.value)}  
              rows={3}  
              className="resize-none transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:border-slate-400"  
            />  
            <p className="text-xs text-slate-500">  
              Example: "Please preserve all mathematical formulas" or "Use formal academic Estonian"  
            </p>  
          </div>  
  
          <Button  
            onClick={handleTranslate}  
            disabled={status !== 'idle' && status !== 'complete' && status !== 'error'}  
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02]"  
            size="lg"  
          >  
            {status === 'idle' || status === 'complete' || status === 'error' ? (  
              <>  
                <FileText className="w-5 h-5 mr-2" />  
                Start Translation  
              </>  
            ) : (  
              <>  
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />  
                Processing...  
              </>  
            )}  
          </Button>  
        </CardContent>  
      </Card>  
  
      {status !== 'idle' && (  
        <Card className="mt-6 shadow-lg border-slate-200">  
          <CardHeader>  
            <div className="flex items-center justify-between">  
              <CardTitle className="text-lg">Translation Progress</CardTitle>  
              {getStatusBadge()}  
            </div>  
          </CardHeader>  
          <CardContent className="space-y-4">  
            <Progress value={progress} className="h-2" />  
            <div className="space-y-1">  
              <p className="text-sm font-medium text-slate-700">{statusMessage}</p>  
              {currentArticle && (  
                <p className="text-xs text-slate-500 truncate">{currentArticle}</p>  
              )}  
            </div>  
  
            {messages.length > 0 && (  
              <div className="space-y-3 mt-4">  
                <h3 className="font-semibold text-sm text-slate-700">Conversation</h3>  
                <div className="space-y-2 max-h-64 overflow-y-auto">  
                  {messages.map((msg) => (  
                    <Alert key={msg.id} className={msg.type === 'user' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}>  
                      <AlertDescription className="text-sm">  
                        <span className="font-semibold">{msg.type === 'user' ? 'You: ' : 'Assistant: '}</span>  
                        {msg.content}  
                      </AlertDescription>  
                    </Alert>  
                  ))}  
                </div>  
  
                {status === 'awaiting_input' && (  
                  <div className="space-y-2 pt-2">  
                    <Textarea  
                      placeholder="Type your response..."  
                      value={userInput}  
                      onChange={(e) => setUserInput(e.target.value)}  
                      onKeyDown={(e) => {  
                        if (e.key === 'Enter' && !e.shiftKey) {  
                          e.preventDefault();  
                          handleUserResponse();  
                        }  
                      }}  
                      rows={2}  
                      className="resize-none"  
                    />  
                    <Button onClick={handleUserResponse} disabled={!userInput.trim()} className="w-full">  
                      Send Response  
                    </Button>  
                  </div>  
                )}  
              </div>  
            )}  
  
            {status === 'complete' && (  
              <Alert className="bg-green-50 border-green-200">  
                <CheckCircle className="h-4 w-4 text-green-600" />  
                <AlertDescription className="text-green-800">  
                  Translation complete! Your .docx file has been downloaded.  
                </AlertDescription>  
              </Alert>  
            )}  
  
            {status === 'error' && (  
              <Alert variant="destructive">  
                <AlertCircle className="h-4 w-4" />  
                <AlertDescription>{statusMessage}</AlertDescription>  
              </Alert>  
            )}  
          </CardContent>  
        </Card>  
      )}  
  
      <footer className="mt-12 text-center space-y-3 pb-8">  
        <div className="flex items-center justify-center gap-2 text-sm text-slate-600">  
          <div className="flex items-center gap-1.5 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">  
            <CheckCircle className="w-4 h-4 text-green-600" />  
            <span>Your API key is never stored</span>  
          </div>  
          <div className="flex items-center gap-1.5 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">  
            <CheckCircle className="w-4 h-4 text-green-600" />  
            <span>Translations processed securely</span>  
          </div>  
        </div>  
        <p className="text-xs text-slate-500">  
          Powered by Google Gemini 2.5 Pro • Built for Estonian scientific community  
        </p>  
      </footer>  
    </div>  
  );  
} 
