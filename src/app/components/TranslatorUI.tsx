'use client';  
  
import { useState, useEffect } from 'react';  
import { Download, Loader2 } from 'lucide-react';  
  
export default function TranslatorUI() {  
  const [apiKey, setApiKey] = useState('');  
  const [gemPrompt, setGemPrompt] = useState('');  
  const [articleInput, setArticleInput] = useState('');  
  const [isTranslating, setIsTranslating] = useState(false);  
  const [progress, setProgress] = useState('');  
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));  
  const [conversationMode, setConversationMode] = useState(false);  
  const [userResponse, setUserResponse] = useState('');  
  const [gemPromptExpanded, setGemPromptExpanded] = useState(false);  
  
  useEffect(() => {  
    const savedApiKey = localStorage.getItem('gemini_api_key');  
    const savedGemPrompt = localStorage.getItem('gem_prompt');  
    if (savedApiKey) setApiKey(savedApiKey);  
    if (savedGemPrompt) setGemPrompt(savedGemPrompt);  
  }, []);  
  
  const saveToLocalStorage = () => {  
    if (apiKey) localStorage.setItem('gemini_api_key', apiKey);  
    if (gemPrompt) localStorage.setItem('gem_prompt', gemPrompt);  
  };  
  
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
    saveToLocalStorage();  
  
    if (!apiKey) {  
      alert('Please enter your Gemini API key');  
      return;  
    }  
  
    const entries = parseArticleEntries(articleInput);  
  
    if (entries.length === 0) {  
      alert('Please enter at least one article URL');  
      return;  
    }  
  
    setIsTranslating(true);  
    setProgress(`Processing ${entries.length} article${entries.length > 1 ? 's' : ''}...`);  
    setConversationMode(false);  
  
    try {  
      const response = await fetch('/api/translate', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({  
          apiKey,  
          articles: entries,  
          sessionId,  
          gemPrompt: gemPrompt || undefined,  
        }),  
      });  
  
      if (!response.ok) {  
        const error = await response.json();  
        throw new Error(error.error || 'Translation failed');  
      }  
  
      const data = await response.json();  
  
      if (data.question) {  
        setProgress('Gemini has a question:');  
        setConversationMode(true);  
        setUserResponse('');  
      } else if (data.downloadUrl) {  
        setProgress('Translation complete! Downloading...');  
        const link = document.createElement('a');  
        link.href = data.downloadUrl;  
        link.download = data.filename;  
        document.body.appendChild(link);  
        link.click();  
        document.body.removeChild(link);  
        setProgress('✓ Download complete!');  
        setTimeout(() => {  
          setIsTranslating(false);  
          setProgress('');  
        }, 2000);  
      }  
    } catch (error) {  
      setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);  
      setTimeout(() => {  
        setIsTranslating(false);  
        setProgress('');  
      }, 3000);  
    }  
  };  
  
  const handleContinueConversation = async () => {  
    if (!userResponse.trim()) {  
      alert('Please enter your response');  
      return;  
    }  
  
    setProgress('Sending your response...');  
    setConversationMode(false);  
  
    try {  
      const response = await fetch('/api/translate', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({  
          apiKey,  
          sessionId,  
          userMessage: userResponse,  
        }),  
      });  
  
      if (!response.ok) {  
        const error = await response.json();  
        throw new Error(error.error || 'Translation failed');  
      }  
  
      const data = await response.json();  
  
      if (data.question) {  
        setProgress('Gemini has another question:');  
        setConversationMode(true);  
        setUserResponse('');  
      } else if (data.downloadUrl) {  
        setProgress('Translation complete! Downloading...');  
        const link = document.createElement('a');  
        link.href = data.downloadUrl;  
        link.download = data.filename;  
        document.body.appendChild(link);  
        link.click();  
        document.body.removeChild(link);  
        setProgress('✓ Download complete!');  
        setTimeout(() => {  
          setIsTranslating(false);  
          setProgress('');  
        }, 2000);  
      }  
    } catch (error) {  
      setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);  
      setTimeout(() => {  
        setIsTranslating(false);  
        setProgress('');  
      }, 3000);  
    }  
  };  
  
  return (  
    <div className="container mx-auto px-4 py-8 max-w-4xl">  
      <div className="bg-white rounded-lg shadow-lg p-6">  
        <h1 className="text-3xl font-bold mb-6 text-gray-800">Science Article Translator</h1>  
  
        <div className="space-y-4">  
          <div>  
            <label className="block text-sm font-medium text-gray-700 mb-2">  
              Gemini API Key  
            </label>  
            <input  
              type="password"  
              value={apiKey}  
              onChange={(e) => setApiKey(e.target.value)}  
              placeholder="Enter your Gemini API key"  
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"  
            />  
          </div>  
  
          <div>  
            <button  
              onClick={() => setGemPromptExpanded(!gemPromptExpanded)}  
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"  
            >  
              <span>Gem Prompt (Optional)</span>  
              <span className="text-gray-400">{gemPromptExpanded ? '−' : '+'}</span>  
            </button>  
            {gemPromptExpanded && (  
              <textarea  
                value={gemPrompt}  
                onChange={(e) => setGemPrompt(e.target.value)}  
                placeholder="Paste your Gem prompt here (optional)"  
                rows={6}  
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"  
              />  
            )}  
          </div>  
  
          <div>  
            <label className="block text-sm font-medium text-gray-700 mb-2">  
              Articles (Estonian title + URL, one per section)  
            </label>  
            <textarea  
              value={articleInput}  
              onChange={(e) => setArticleInput(e.target.value)}  
              placeholder="Estonian Article Title&#10;https://example.com/article1&#10;&#10;Another Estonian Title&#10;https://example.com/article2"  
              rows={10}  
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"  
            />  
          </div>  
  
          {!conversationMode ? (  
            <button  
              onClick={handleTranslate}  
              disabled={isTranslating}  
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"  
            >  
              {isTranslating ? (  
                <>  
                  <Loader2 className="w-5 h-5 animate-spin" />  
                  Translating...  
                </>  
              ) : (  
                <>  
                  <Download className="w-5 h-5" />  
                  Translate & Download  
                </>  
              )}  
            </button>  
          ) : (  
            <div className="space-y-4">  
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">  
                <p className="text-sm font-medium text-blue-900 mb-2">Gemini's Question:</p>  
                <p className="text-sm text-blue-800">{progress.replace('Gemini has a question:', '').trim()}</p>  
              </div>  
              <textarea  
                value={userResponse}  
                onChange={(e) => setUserResponse(e.target.value)}  
                placeholder="Type your response here..."  
                rows={4}  
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"  
              />  
              <button  
                onClick={handleContinueConversation}  
                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"  
              >  
                Send Response  
              </button>  
            </div>  
          )}  
  
          {progress && !conversationMode && (  
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">  
              <p className="text-sm text-gray-700">{progress}</p>  
            </div>  
          )}  
        </div>  
      </div>  
    </div>  
  );  
}  
