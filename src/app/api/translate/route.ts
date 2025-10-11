// KOPEERI KOGU SEE KOOD JA ASENDA OMA route.ts FAILI SISUGA

import { type NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';

const activeSessions = new Map<string, {
  articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>;
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }>;
  apiKey: string;
  gemPrompt?: string;
  customPrompt?: string;
}>();

// --- UUS JA PARANDATUD scrapeArticle FUNKTSIOON ALGAB SIIT ---

async function scrapeArticle(url: string, estonianTitle?: string) {
  console.log(`[Browserless] Attempting to scrape URL: ${url}`);

  const browserlessApiKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessApiKey) {
    throw new Error('Browserless.io API key is not configured in environment variables.');
  }

  try {
    // Teeme päringu Browserless.io API-le, mis omakorda avab lehe päris Chrome'is
    const response = await fetch('https://chrome.browserless.io/content', {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        token: browserlessApiKey,
        // Anname lehele aega laadida, et Cloudflare'i skriptid saaksid joosta
        waitFor: 3000, 
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Browserless] Failed to fetch: ${response.status}`, errorText);
      throw new Error(`Browserless.io service failed with status ${response.status}. The site may still be blocking access.`);
    }

    const html = await response.text();
    console.log(`[Browserless] HTML received: ${html.length} characters`);

    // Edasine kood kasutab Cheeriot, et PUHASTADA juba kätte saadud HTML-i.
    // See osa on peaaegu identne sinu vana koodiga.
    const $ = cheerio.load(html);
    const baseUrl = new URL(url);

    let title = $('h1').first().text().trim();
    if (!title) {
      title = $('title').text().trim();
    }

    const contentSelectors = [
      '.article-main', '.entry-content', 'article .entry-content', '.post-content',
      '.article-content', '.article-body', 'article', '[role="main"]', '.content',
      '.post', '.single-post', '.entry', '#content', '#main-content', 'main article', 'main',
    ];

    let contentElement = null;
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length && (element.text().trim().length > 150 || element.find('p').length >= 3)) {
        contentElement = element;
        console.log(`[Parser] Selected content with selector: ${selector}`);
        break;
      }
    }

    if (!contentElement) {
      console.log('[Parser] No specific content container found, falling back to body.');
      contentElement = $('body');
    }

    contentElement.find(`
      script, style, nav, header, footer, aside, iframe, form, button, input,
      .ad, .advertisement, .promo, .promotion, .popup,
      .social-share, .share-buttons, .social-links, .social-follow,
      .newsletter-signup, .newsletter, .subscription, .subscribe,
      .cookie-notice, .author-bio, .related-posts, .related-articles, 
      .comments, .comment-section, .copyright, .site-footer, .site-header
    `).remove();

    let markdownContent = '';
    contentElement.find('p, h2, h3, h4').each((_, elem) => {
        const text = $(elem).text().trim();
        if (text && text.length > 25) { // Suurendame miinimum pikkust, et vältida müra
            markdownContent += text + '\n\n';
        }
    });
    
    if (markdownContent.trim().length < 100) {
        throw new Error('Could not extract sufficient content after parsing with Cheerio.');
    }

    return {
      title: estonianTitle || title,
      content: markdownContent.trim(),
      url,
      estonianTitle,
    };

  } catch (error) {
    console.error(`[Scraping Process] Failed for ${url}:`, error);
    // Anname vea edasi, et POST funktsioon saaks selle kinni püüda.
    throw error;
  }
}

// --- UUS JA PARANDATUD scrapeArticle FUNKTSIOON LÕPPEB SIIN ---

// Sinu translateWithGemini ja teised abifunktsioonid jäävad siia alles täpselt sellisena, nagu need olid.
// Ma ei lisa neid siia uuesti, et vastus liiga pikaks ei läheks.
// Lihtsalt veendu, et sinu `translateWithGemini` ja `removeRelatedArticlesList` on alles.

// Selles vastuses on ainult `scrapeArticle` ja `POST` funktsioonid.
// Kopeeri need kaks ja asenda oma failis olevad samanimelised funktsioonid.
// Kõige lihtsam on siiski asendada terve faili sisu.

async function removeRelatedArticlesList(content: string): Promise<string> {
    // See funktsioon jääb samaks
    return content;
}

async function translateWithGemini(
    articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>,
    apiKey: string,
    gemPrompt?: string,
    customPrompt?: string,
    conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = []
  ): Promise<{ complete: boolean; translation?: string; question?: string; conversationHistory?: any }> {
    // See funktsioon jääb samaks
    // Veendu, et sinu pikk ja detailne Gemini prompt on siin alles
    return { complete: true, translation: "Tõlke näide" }; // Placeholder
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
          // NÜÜD KUTSUME VÄLJA UUE, VÕIMSA FUNKTSIOONI
          const article = await scrapeArticle(url, estonianTitle);
          articles.push(article);
        } catch (error) {
          // Kui isegi Browserless ebaõnnestub, siis logime vea.
          console.error(`[API] Final error for ${url}:`, error);
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

    // Ülejäänud 'action'id (translate, answer, download) jäävad samaks
    // ...
    
    // Näidisena, et kood kompileeruks, lisan siia ülejäänud osa, aga
    // kasuta kindlasti oma originaalset loogikat siin.
    if (action === 'translate' || action === 'answer' || action === 'download') {
        // Siia peaks tulema sinu loogika nende tegevuste jaoks,
        // mis on juba olemas sinu praeguses failis.
        // Ma ei saa neid siin uuesti luua ilma sinu täieliku 'translateWithGemini' funktsioonita.
        // Parim on, kui sa asendad oma failis ainult 'scrapeArticle' funktsiooni
        // ja 'POST' funktsiooni 'scrape' osa.
        return NextResponse.json({ message: "Action handler not fully implemented in this example" });
    }


    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('API Route Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}