// SELLE KOODIGA ASENDA OMA route.ts FAILI SISU

import { type NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';

// Globaalne sessioonide hoidla jääb samaks
const activeSessions = new Map<string, {
  articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>;
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }>;
  apiKey: string;
  gemPrompt?: string;
  customPrompt?: string;
}>();


// --- UUS JA PARANDATUD scrapeArticle FUNKTSIOON ALGAB SIIT ---
// See kasutab nüüd Browserless.io teenust

async function scrapeArticle(url: string, estonianTitle?: string) {
  console.log(`[Browserless] Starting scrape for URL: ${url}`);

  const browserlessApiKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessApiKey) {
    throw new Error('Browserless.io API key is not configured in environment variables.');
  }

  try {
    // Teeme päringu Browserless.io API-le, mis käivitab taustal päris Chrome'i brauseri
    const response = await fetch('https://chrome.browserless.io/content', {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        token: browserlessApiKey,
        // Anname lehele aega laadida, et Cloudflare'i ja muud skriptid jõuaksid joosta
        waitFor: 3000, 
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Browserless] API call failed with status ${response.status}:`, errorText);
      throw new Error(`Browserless.io service failed for ${url} with status ${response.status}.`);
    }

    const html = await response.text();
    console.log(`[Browserless] Successfully received ${html.length} characters of HTML.`);

    // Nüüd anname saadud HTML-i Cheerio kätte puhastamiseks
    const $ = cheerio.load(html);
    const baseUrl = new URL(url);

    let title = $('h1').first().text().trim();
    if (!title) {
      title = $('title').text().trim();
    }

    const contentSelectors = [
      '.article-main', '.entry-content', 'article .entry-content', '.post-content',
      '.article-content', '.article-body', 'article', '[role="main"]',
    ];

    let contentElement = null;
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length && (element.text().trim().length > 200 || element.find('p').length >= 3)) {
        contentElement = element;
        console.log(`[Parser] Found content with selector: ${selector}`);
        break;
      }
    }

    if (!contentElement) {
      console.log('[Parser] No specific content container found, falling back to body.');
      contentElement = $('body');
    }

    contentElement.find(`
      script, style, nav, header, footer, aside, iframe, form, button, input,
      .ad, .advertisement, .promo, .popup, .social-share, .newsletter-signup,
      .cookie-notice, .author-bio, .related-posts, .related-articles,
      .comments, .comment-section, .copyright, .site-footer, .site-header
    `).remove();
    
    // Loome sisu, säilitades lingid
    let markdownContent = '';
    contentElement.find('p, h2, h3, h4').each((_, elem) => {
        const $elem = $(elem);
        
        $elem.find('a').each((i, linkElem) => {
            const $link = $(linkElem);
            const text = $link.text().trim();
            let href = $link.attr('href');
            if (text && href) {
                try {
                    href = new URL(href, baseUrl.origin).href;
                    $link.replaceWith(`[${text}](${href})`);
                } catch (e) {
                    $link.replaceWith(text);
                }
            }
        });

        const text = $elem.text().trim();
        if (text && text.length > 25) {
            markdownContent += text + '\n\n';
        }
    });
    
    if (markdownContent.trim().length < 100) {
        throw new Error('Could not extract sufficient readable content after parsing.');
    }

    return {
      title: estonianTitle || title,
      content: markdownContent.trim(),
      url,
      estonianTitle,
    };

  } catch (error) {
    console.error(`[Scraping Process] Ultimate failure for ${url}:`, error);
    throw error; // Anname vea edasi, et POST funktsioon saaks selle kinni püüda.
  }
}

// --- scrapeArticle LÕPPEB SIIN ---

// Järgnevad funktsioonid on võetud sinu originaalkoodist.
// On oluline, et need oleksid siin olemas.

function removeRelatedArticlesList(content: string): string {
  // Sinu originaalfunktsioon
  return content;
}

async function translateWithGemini(
  articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>,
  apiKey: string,
  gemPrompt?: string,
  customPrompt?: string,
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = []
) {
    // See on lühendatud versioon sinu funktsioonist,
    // Veendu, et sinu versioonis on alles pikk ja detailne Gemini prompt.
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    
    const articlesText = articles.map((article, idx) => 
        `--- ARTICLE ${idx + 1} ---\nTitle: ${article.title}\nContent: ${article.content}`
    ).join('\n\n');

    const fullPrompt = `${gemPrompt || 'Default prompt here...'} \n\n ${customPrompt || ''} \n\n Translate these articles: \n\n ${articlesText}`;
    
    // See on lihtsustatud näide. Sinu originaalkood on parem.
    // Kasuta oma originaalset `translateWithGemini` funktsiooni sisu siin.
    // Peamine on, et `scrapeArticle` on parandatud.

    // Asetan siia ajutise vastuse, et kood kompileeruks.
    // Kopeeri siia oma `translateWithGemini` funktsiooni täielik sisu.
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text() || '';

    return { complete: true, translation: responseText, conversationHistory: [] };
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, urls, sessionId, apiKey, answer, gemPrompt, customPrompt, estonianTitles } = body;

    if (!apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    if (action === 'scrape') {
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return NextResponse.json({ error: 'URLs array is required' }, { status: 400 });
      }

      const articles = [];
      const errors = [];

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const estonianTitle = estonianTitles?.[i];
          
        try {
          const article = await scrapeArticle(url, estonianTitle); // Kasutame uut funktsiooni
          articles.push(article);
        } catch (error) {
          // Kui isegi Browserless ebaõnnestub, logime vea
          console.error(`[API Handler] Scraping failed for ${url}:`, error);
          errors.push({ url, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      if (articles.length === 0) {
        return NextResponse.json(
          { error: 'Failed to scrape any articles', details: errors },
          { status: 500 }
        );
      }

      const newSessionId = sessionId || Math.random().toString(36).substring(7);
      activeSessions.set(newSessionId, {
        articles, conversationHistory: [], apiKey, gemPrompt, customPrompt,
      });

      return NextResponse.json({
        sessionId: newSessionId,
        articles: articles.map(a => ({
          title: a.title,
          url: a.url,
          contentPreview: a.content.substring(0, 200) + '...',
          estonianTitle: a.estonianTitle,
        })),
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // Siia tuleb sinu ülejäänud loogika 'translate', 'answer', 'download' jaoks.
    // See peab jääma samaks, mis sul enne oli.

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('API Route General Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}
