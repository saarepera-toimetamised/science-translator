// KOPEERI KOGU SEE KOOD JA ASENDA OMA TranslatorUI.tsx FAILI SISUGA

'use client';

import { useState, useEffect } from 'react';

type TranslationStatus = 'idle' | 'fetching' | 'translating' | 'complete' | 'error' | 'awaiting_input';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
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
      setStatusMessage('Please provide at least one article URL and your API key');
      return;
    }

    setStatus('fetching');
    setProgress(10);
    setStatusMessage(`Scraping ${articleEntries.length} article${articleEntries.length > 1 ? 's' : ''}...`);
    setMessages([]);

    try {
      // --- PARANDUS ALGAB SIIT ---
      // Eraldame URL-id ja pealkirjad eraldi massiivideks, nagu backend ootab
      const urlsToScrape = articleEntries.map(entry => entry.url);
      const estonianTitles = articleEntries.map(entry => entry.estonianTitle || null);

      const scrapeResponse = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'scrape', // Lisasime puuduva 'action' välja
          urls: urlsToScrape,
          estonianTitles, 
          apiKey, 
          gemPrompt,
          customPrompt 
        }),
      });

      const scrapeData = await scrapeResponse.json();

      if (!scrapeResponse.ok) {
        const errorMessage = scrapeData.details ? `${scrapeData.error}: ${JSON.stringify(scrapeData.details)}` : scrapeData.error;
        throw new Error(errorMessage || 'Scraping failed');
      }
      
      // Kui kraapimine õnnestus (või loodi fallback ülesanne), alustame kohe tõlkimist
      const currentSessionId = scrapeData.sessionId;
      setSessionId(currentSessionId);
      setStatus('translating');
      setProgress(50);
      setStatusMessage('Articles processed, starting translation with Gemini...');

      const translateResponse = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              action: 'translate',
              sessionId: currentSessionId,
              apiKey,
          }),
      });

      const translateData = await translateResponse.json();

      if (!translateResponse.ok) {
          throw new Error(translateData.error || 'Translation request failed');
      }

      if (translateData.question) {
        setStatus('awaiting_input');
        setMessages([{ type: 'assistant', content: translateData.question, id: `msg-${Date.now()}` }]);
        setProgress(75);
        setStatusMessage('Waiting for your input...');
      } else if (translateData.translation) {
        // Kui tõlge on valmis, käivitame allalaadimise
        const downloadResponse = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'download',
                sessionId: currentSessionId,
                translation: translateData.translation,
            })
        });

        if(!downloadResponse.ok) {
            const errorData = await downloadResponse.json();
            throw new Error(errorData.error || 'Download failed');
        }
        
        const blob = await downloadResponse.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `translation_${Date.now()}.docx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);

        setStatus('complete');
        setProgress(100);
        setStatusMessage('Translation complete and file downloaded!');
      }
      // --- PARANDUS LÕPPEB SIIN ---

    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'An error occurred');
    }
  };

  const handleUserResponse = async () => {
    if (!userInput.trim() || !sessionId) return;

    setMessages([...messages, { type: 'user', content: userInput, id: `msg-${Date.now()}` }]);
    setStatus('translating');
    setStatusMessage('Processing your input...');
    setUserInput('');

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // --- PARANDUS ALGAB SIIT ---
        body: JSON.stringify({
          action: 'answer', // Lisasime puuduva 'action' välja
          sessionId,
          answer: userInput, // Muudetud userInput -> answer, et vastata backendile
          apiKey,
        }),
        // --- PARANDUS LÕPPEB SIIN ---
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Translation failed');
      }

      if (data.question) {
        setStatus('awaiting_input');
        setMessages(prev => [...prev, { type: 'assistant', content: data.question, id: `msg-${Date.now()}` }]);
        setProgress(prev => Math.min(90, prev + 10));
        setStatusMessage('Waiting for your input...');
      } else if (data.translation) {
        // Kordame allalaadimise loogikat
        const downloadResponse = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'download',
                sessionId: sessionId,
                translation: data.translation,
            })
        });

        if(!downloadResponse.ok) {
            const errorData = await downloadResponse.json();
            throw new Error(errorData.error || 'Download failed');
        }
        
        const blob = await downloadResponse.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `translation_${Date.now()}.docx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);

        setStatus('complete');
        setProgress(100);
        setStatusMessage('Translation complete and file downloaded!');
      }
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'An error occurred');
    }
  };

  // Ülejäänud JSX kood jääb samaks
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '48px', fontWeight: 'bold', background: 'linear-gradient(to right, #2563eb, #4f46e5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '16px' }}>
          Science Article Translator
        </h1>
        <p style={{ fontSize: '18px', color: '#334155' }}>
          High-end English to Estonian translation powered by Gemini 2.5 Pro
        </p>
      </div>

      <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', padding: '32px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '24px', color: '#1e293b' }}>Configuration</h2>
        
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#334155' }}>
            Articles to Translate
          </label>
          <textarea
            placeholder="Paste article URLs (one per line) or Estonian title + URL"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            style={{ width: '100%', minHeight: '120px', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit' }}
            rows={6}
          />
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            Example: https://phys.org/news/article.html
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#334155' }}>
            Gemini API Key
          </label>
          <input
            type="password"
            placeholder="Enter your Gemini API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', fontFamily: 'monospace' }}
          />
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            Get your free API key from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
              Google AI Studio
            </a>
          </p>
        </div>

        <div style={{ marginBottom: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '24px' }}>
          <button
            type="button"
            onClick={() => setShowGemPrompt(!showGemPrompt)}
            style={{ background: 'none', border: 'none', fontSize: '14px', fontWeight: '500', color: '#334155', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '0' }}
          >
            <span style={{ fontSize: '16px' }}>{showGemPrompt ? '▼' : '▶'}</span>
            Your Gem Prompt (Optional)
          </button>
          {showGemPrompt && (
            <div style={{ marginTop: '16px' }}>
              <textarea
                placeholder="Paste your custom Gemini prompt here..."
                value={gemPrompt}
                onChange={(e) => setGemPrompt(e.target.value)}
                style={{ width: '100%', minHeight: '200px', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}
                rows={10}
              />
            </div>
          )}
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#334155' }}>
            Custom Instructions <span style={{ color: '#94a3b8', fontWeight: 'normal' }}>(Optional)</span>
          </label>
          <textarea
            placeholder="Add any specific translation instructions..."
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            style={{ width: '100%', minHeight: '80px', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', resize: 'none' }}
            rows={3}
          />
        </div>

        <button
          onClick={handleTranslate}
          disabled={status !== 'idle' && status !== 'complete' && status !== 'error'}
          style={{
            width: '100%',
            padding: '16px',
            background: status === 'idle' || status === 'complete' || status === 'error' ? 'linear-gradient(to right, #2563eb, #4f46e5)' : '#94a3b8',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: status === 'idle' || status === 'complete' || status === 'error' ? 'pointer' : 'not-allowed',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
            transition: 'all 0.2s'
          }}
        >
          {status === 'idle' || status === 'complete' || status === 'error' ? '▶ Start Translation' : '⏳ Processing...'}
        </button>
      </div>

      {status !== 'idle' && (
        <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '24px', marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', margin: 0 }}>Translation Progress</h3>
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: status === 'complete' ? '#dcfce7' : status === 'error' ? '#fee2e2' : '#dbeafe',
              color: status === 'complete' ? '#166534' : status === 'error' ? '#991b1b' : '#1e40af'
            }}>
              {status === 'complete' ? '✓ Complete' : status === 'error' ? '✗ Error' : status === 'fetching' ? '⟳ Fetching' : status === 'translating' ? '⟳ Translating' : '⏸ Waiting'}
            </span>
          </div>

          <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ width: `${progress}%`, height: '100%', backgroundColor: '#2563eb', transition: 'width 0.3s' }}></div>
          </div>

          <p style={{ fontSize: '14px', color: '#334155', marginBottom: '16px' }}>{statusMessage}</p>

          {messages.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Conversation</h4>
              <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
                {messages.map((msg) => (
                  <div key={msg.id} style={{ 
                    padding: '12px', 
                    marginBottom: '8px', 
                    borderRadius: '8px', 
                    backgroundColor: msg.type === 'user' ? '#eff6ff' : '#f8fafc',
                    border: '1px solid ' + (msg.type === 'user' ? '#bfdbfe' : '#e2e8f0')
                  }}>
                    <span style={{ fontWeight: '600', fontSize: '13px' }}>{msg.type === 'user' ? 'You: ' : 'Assistant: '}</span>
                    <span style={{ fontSize: '13px' }}>{msg.content}</span>
                  </div>
                ))}
              </div>

              {status === 'awaiting_input' && (
                <div>
                  <textarea
                    placeholder="Type your response..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    style={{ width: '100%', minHeight: '60px', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', marginBottom: '8px', resize: 'none' }}
                    rows={2}
                  />
                  <button 
                    onClick={handleUserResponse} 
                    disabled={!userInput.trim()}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: userInput.trim() ? '#2563eb' : '#94a3b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: userInput.trim() ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Send Response
                  </button>
                </div>
              )}
            </div>
          )}

          {status === 'complete' && (
            <div style={{ padding: '12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', color: '#166534', fontSize: '14px' }}>
              ✓ Translation complete! Your .docx file has been downloaded.
            </div>
          )}

          {status === 'error' && (
            <div style={{ padding: '12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', fontSize: '14px' }}>
              ✗ {statusMessage}
            </div>
          )}
        </div>
      )}

      <footer style={{ marginTop: '48px', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
        <p>Powered by Google Gemini 2.5 Pro • Built for Estonian scientific community</p>
      </footer>
    </div>
  );
}