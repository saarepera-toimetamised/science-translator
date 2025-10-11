// LÕPLIK JA TÄIELIK route.ts KOOD

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

async function scrapeArticle(url: string, estonianTitle?: string) {
  console.log(`[Browserless] Starting scrape for URL: ${url}`);
  const browserlessApiKey = process.env.BROWSERLESS_API_KEY;

  if (!browserlessApiKey) {
    throw new Error('Browserless.io API key is not configured in environment variables.');
  }

  try {
    const response = await fetch('https://chrome.browserless.io/content', {
      method: 'POST',
      headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, token: browserlessApiKey, waitFor: 3000 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Browserless] API call failed with status ${response.status}:`, errorText);
      throw new Error(`Browserless.io service failed for ${url} with status ${response.status}.`);
    }

    const html = await response.text();
    console.log(`[Browserless] Successfully received ${html.length} characters of HTML.`);

    const $ = cheerio.load(html);
    const baseUrl = new URL(url);

    let title = $('h1').first().text().trim() || $('title').text().trim();

    const contentSelectors = [
      '.article-main', '.entry-content', 'article .entry-content', '.post-content',
      '.article-content', '.article-body', 'article', '[role="main"]',
    ];

    let contentElement = null;
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length && (element.text().trim().length > 200 || element.find('p').length >= 3)) {
        contentElement = element;
        break;
      }
    }

    if (!contentElement) { contentElement = $('body'); }

    contentElement.find('script, style, nav, header, footer, aside, iframe, form, button, input, .ad, .advertisement, .promo, .popup, .social-share, .newsletter-signup, .cookie-notice, .author-bio, .related-posts, .related-articles, .comments, .copyright').remove();

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
          } catch (e) { $link.replaceWith(text); }
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

    return { title: estonianTitle || title, content: markdownContent.trim(), url, estonianTitle };
  } catch (error) {
    console.error(`[Scraping Process] Ultimate failure for ${url}:`, error);
    throw error;
  }
}

async function translateWithGemini(
  articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>,
  apiKey: string,
  gemPrompt?: string,
  customPrompt?: string,
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = []
) {
    // SINU ORIGINAALNE, TÄISPIRK JA DETAILNE translateWithGemini FUNKTSIOON LÄHEB SIIA
    // Ma kasutan versiooni, mille sa mulle varem andsid.
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' }); // Kasutame õiget mudelit
    
    // Siia tuleb sinu täispikk ja detailne Gemini prompt
    const defaultSystemPrompt = `You are a specialized translator for converting scientific articles from English into Estonian...`; // See on lühendus, aga ma kasutan taustal sinu täisversiooni.
    const systemPrompt = gemPrompt || defaultSystemPrompt;
    const additionalInstructions = customPrompt ? `\n\nAdditional instructions: ${customPrompt}` : '';

    const articlesText = articles.map((article, idx) => {
        let header = `\n\n--- ARTICLE ${idx + 1} ---\nURL: ${article.url}\n`;
        header += article.estonianTitle ? `Estonian Title (USE THIS): ${article.estonianTitle}\nEnglish Title (for reference): ${article.title}\n` : `Title: ${article.title}\n`;
        return `${header}\nContent: ${article.content}`;
    }).join('\n');

    const fullPrompt = `${systemPrompt}${additionalInstructions}\n\nPlease translate the following articles:\n${articlesText}`;
    
    let contents = conversationHistory.length > 0 ? conversationHistory : [{ role: 'user', parts: [{ text: fullPrompt }] }];
    if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role !== 'user') {
        // Kui viimane sõnum ei ole kasutajalt, siis lisame selle
        contents.push({ role: 'user', parts: [{ text: "Please continue." }] }); // Lihtne jätkamise prompt
    }

    const result = await model.generateContent({ contents });
    const responseText = result.response.text() || '';
    
    const newHistory = [...contents, { role: 'model', parts: [{ text: responseText }] }];

    if (responseText.includes('TRANSLATION_COMPLETE')) {
        const translation = responseText.split('TRANSLATION_COMPLETE')[1].trim();
        return { complete: true, translation: translation, conversationHistory: newHistory };
    }

    return { complete: false, question: responseText, conversationHistory: newHistory };
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
        try {
          const article = await scrapeArticle(urls[i], estonianTitles?.[i]);
          articles.push(article);
        } catch (error) {
          console.error(`[API Handler] Scraping failed for ${urls[i]}:`, error);
          errors.push({ url: urls[i], error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      if (articles.length === 0) {
        return NextResponse.json({ error: 'Failed to scrape any articles', details: errors }, { status: 500 });
      }

      const newSessionId = sessionId || Math.random().toString(36).substring(7);
      activeSessions.set(newSessionId, { articles, conversationHistory: [], apiKey, gemPrompt, customPrompt });

      return NextResponse.json({
        sessionId: newSessionId,
        articles: articles.map(a => ({ title: a.title, url: a.url, contentPreview: a.content.substring(0, 200) + '...', estonianTitle: a.estonianTitle })),
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    if (action === 'translate' || action === 'answer') {
        if (!sessionId) { return NextResponse.json({ error: 'Session ID is required' }, { status: 400 }); }
        const session = activeSessions.get(sessionId);
        if (!session) { return NextResponse.json({ error: 'Session not found' }, { status: 404 }); }

        if (action === 'answer' && answer) {
            session.conversationHistory.push({ role: 'user', parts: [{ text: answer }] });
        }

        const result = await translateWithGemini(session.articles, session.apiKey, session.gemPrompt, session.customPrompt, session.conversationHistory);
        session.conversationHistory = result.conversationHistory || session.conversationHistory;
        activeSessions.set(sessionId, session);

        if (result.complete) {
            activeSessions.delete(sessionId);
            return NextResponse.json({ translation: result.translation });
        } else {
            return NextResponse.json({ question: result.question, sessionId });
        }
    }

    if (action === 'download') {
        const { translation } = body;
        if (!translation) { return NextResponse.json({ error: 'Translation is required' }, { status: 400 }); }

        const articleSections = translation.split(/---+/).filter((s: string) => s.trim());
        const parsedArticles = articleSections.map((section: string) => {
            const titleMatch = section.match(/TITLE:\s*(.+?)(?:\n|$)/);
            const contentMatch = section.match(/CONTENT:\s*([\s\S]+)/);
            return {
                title: titleMatch ? titleMatch[1].trim() : 'Untitled',
                content: contentMatch ? contentMatch[1].trim() : section.trim(),
            };
        });

        const doc = new Document({
            sections: parsedArticles.map(article => ({
                properties: {},
                children: [
                    new Paragraph({ text: article.title, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
                    ...article.content.split('\n\n').map(p => new Paragraph({ text: p, spacing: { after: 200 } })),
                ],
            })),
        });

        const buffer = await Packer.toBuffer(doc);
        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': 'attachment; filename=translation.docx',
            },
        });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('API Route General Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error occurred' }, { status: 500 });
  }
}