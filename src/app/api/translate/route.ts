import { type NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import * as cheerio from 'cheerio';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';

const activeSessions = new Map<string, {
  articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>;
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }>;
  apiKey: string;
  gemPrompt?: string;
  customPrompt?: string;
}>();

function removeRelatedArticlesList(content: string): string {
  const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
  if (paragraphs.length < 3) return content;
  let cutoffIndex = paragraphs.length;
  let consecutiveShortCount = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const para = paragraphs[i].trim();
    const paraLength = para.length;
    const periodCount = (para.match(/\./g) || []).length;
    const looksLikeHeadline = (
      paraLength >= 30 &&
      paraLength <= 200 &&
      periodCount <= 1 &&
      !para.match(/^(the|a|an|in|on|at|this|these|scientists|researchers|according)/i)
    );
    if (looksLikeHeadline) {
      consecutiveShortCount++;
      if (consecutiveShortCount >= 5) cutoffIndex = i;
    } else if (paraLength > 300) {
      consecutiveShortCount = 0;
      break;
    } else {
      consecutiveShortCount = 0;
    }
  }
  if (cutoffIndex < paragraphs.length - 4) {
    const cleanedParagraphs = paragraphs.slice(0, cutoffIndex);
    console.log(`[Related Articles Filter] Removed ${paragraphs.length - cutoffIndex} suspected related article titles`);
    return cleanedParagraphs.join('\n\n');
  }
  return content;
}

async function scrapeArticle(url: string, estonianTitle?: string) {
  try {
    console.log(`[Scraper] Fetching URL: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    if (!response.ok) {
      console.log(`[Scraper] Failed to fetch: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch article: ${response.statusText}`);
    }
    const html = await response.text();
    console.log(`[Scraper] HTML received: ${html.length} characters`);
    const $ = cheerio.load(html);
    const baseUrl = new URL(url);
    let title = $('h1').first().text().trim() || $('title').text().trim();
    const contentSelectors = [
        '.article-main', '.entry-content', 'article .entry-content', '.post-content', 
        '.article-content', '.article-body', 'article', '[role="main"]', '.content', 
        '.post', '.single-post', '.entry', '#content', '#main-content', 'main article', 'main',
    ];
    let contentElement = null;
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length) {
        const text = element.text().trim();
        const paragraphCount = element.find('p').length;
        if (text.length > 150 || paragraphCount >= 3) {
          contentElement = element;
          console.log(`[Scraper] ✓ Selected content with selector: ${selector}`);
          break;
        }
      }
    }
    if (!contentElement || contentElement.length === 0) {
      console.log('[Scraper] No content found with selectors, falling back to body');
      contentElement = $('body');
    }
    contentElement.find(`
      script, style, nav, header, footer, aside, iframe,
      .ad, .advertisement, .promo, .promotion, .social-share, .share-buttons, .social-links, .social-follow,
      .newsletter-signup, .newsletter, .subscription, .subscribe, .cookie-notice, .author-bio,
      .related-posts, .related-articles, .recommended, .recommendations, .comments, .comment-section,
      .editorial-note, .editor-note, .fact-check, .copyright, .copyright-notice, .legal-notice,
      .more-information, .citation, .article-footer, [class*="newsletter"], [class*="subscribe"], [class*="follow-us"],
      [class*="related"], [class*="recommend"], [class*="copyright"], [class*="editorial"], [class*="editor-"],
      [id*="newsletter"], [id*="subscribe"], [id*="related"], [id*="copyright"]
    `.replace(/\s+/g, ' ').trim()).remove();
    const noisePatterns = [
        /^(published|updated|posted|by|author|share|tweet|email|print|read more|continue reading)/i, 
        /^\d{1,2}\/\d{1,2}\/\d{2,4}/,
        /^\d{4}-\d{2}-\d{2}/,
        /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i, /^(edited by|reviewed by|written by|fact.?checked by)/i,
        /science x edit(or|orial) process|editorial process|editorial policies/i,
        /copyright|all rights reserved|©/i, /provided for (informational|information) purposes/i,
        /^(provided by|more information|further information|additional information)/i, /^(citation|reference|doi):/i,
        /subscribe|newsletter|sign up for|join (our|the)/i, /share (this|the) (article|story|post)/i,
        /(facebook|twitter|instagram|linkedin|youtube|google|discover|news)/i, /click here|learn more|find out|discover more/i,
        /related (articles|stories|posts|content|news|reading)/i, /you (may|might) (also )?(like|enjoy|want|be interested)/i,
        /leave a comment|post a comment|comments|no comments/i,
    ];
    let markdownContent = '';
    contentElement.find('p, h2, h3, h4, h5, h6, div.paragraph, div[class*="content"], div[class*="text"]').each((_, elem) => {
        const $elem = $(elem);
        if ($elem.find('img').length > 0 || $elem.hasClass('caption') || $elem.hasClass('credit') || $elem.hasClass('wp-caption-text')) return;
        if ($elem.closest('.share, .social, nav, .navigation, .menu, .sidebar, .footer, .header').length > 0) return;
        if ($elem.is('div')) {
            const directText = $elem.clone().children().remove().end().text().trim();
            if (directText.length < 20) return;
        }
        const links: Array<{text: string; url: string; placeholder: string}> = [];
        $elem.find('a').each((idx, link) => {
            const $link = $(link);
            const linkText = $link.text().trim();
            let href = $link.attr('href');
            if (linkText && href) {
                try {
                    if (href.startsWith('/')) href = `${baseUrl.protocol}//${baseUrl.host}${href}`;
                    else if (href.startsWith('#') || href.startsWith('javascript:')) return;
                    else if (!href.startsWith('http')) href = new URL(href, url).href;
                    const cleanUrl = new URL(href);
                    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'source', 'cc', 'ust', 'usg', 'fbclid', 'gclid', 'ref'];
                    for (const param of paramsToRemove) cleanUrl.searchParams.delete(param);
                    let finalUrl = cleanUrl.toString();
                    if (finalUrl.endsWith('?')) finalUrl = finalUrl.slice(0, -1);
                    const placeholder = `__LINK_${idx}__`;
                    links.push({text: linkText, url: finalUrl, placeholder});
                    $link.replaceWith(placeholder);
                } catch {}
            }
        });
        let text = $elem.text();
        for (const link of links) {
            text = text.replace(link.placeholder, `[${link.text}](${link.url})`);
        }
        const trimmed = text.trim();
        if (trimmed && trimmed.length > 20) {
            const isNoise = noisePatterns.some(pattern => pattern.test(trimmed));
            if (!isNoise) markdownContent += `${trimmed}\n\n`;
        }
    });
    if (!markdownContent || markdownContent.length < 100) {
        const fallbackText = contentElement.text().replace(/\s+/g, ' ').trim();
        if (fallbackText.length >= 100) markdownContent = fallbackText;
    }
    markdownContent = removeRelatedArticlesList(markdownContent);
    if (!markdownContent || markdownContent.length < 100) {
        throw new Error(`Could not extract sufficient content from the article.`);
    }
    return {
        title,
        content: markdownContent.substring(0, 50000),
        url,
        estonianTitle,
    };
  } catch (error) {
    throw new Error(`Failed to scrape article: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function translateWithGemini(
  articles: Array<{ title: string; content: string; url: string; estonianTitle?: string }>,
  apiKey: string,
  gemPrompt?: string,
  customPrompt?: string,
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = []
) {
  const ai = new GoogleGenAI(apiKey);

  const defaultSystemPrompt = `You are a specialized translator for converting scientific articles from English into Estonian. You make no mistakes. You think hard and understand your instructions on the level of PhD philologist in both languages, English and Estonian.  
  
Always write in natural Estonian, ensuring correct grammar, cases, syntax, and semantics, while preserving full accuracy and nuance. Keep the translation length close to the original.  
  
🔗🔗🔗 HYPERLINKS - MOST CRITICAL RULE - READ THIS FIRST 🔗🔗🔗  
  
THIS IS THE #1 MOST IMPORTANT RULE - FAILURE TO FOLLOW THIS RULE MAKES THE TRANSLATION UNUSABLE:  
  
The source articles contain hyperlinks in markdown format like this: [anchor text](https://url.com)  
You MUST preserve EVERY SINGLE hyperlink in your Estonian translation.  
  
MANDATORY HYPERLINK FORMAT:  
✅ CORRECT: [eestikeelne tekst](https://originaal-url.com)  
❌ WRONG: eestikeelne tekst  
❌ WRONG: https://originaal-url.com  
❌ WRONG: eestikeelne tekst https://originaal-url.com  
  
CONCRETE EXAMPLES - STUDY THESE CAREFULLY:  
  
Example 1:  
English: "according to [researchers at MIT](https://mit.edu/study)"  
Estonian: "nagu [MIT-i teadlased](https://mit.edu/study) väitsid"  
  
Example 2:  
English: "The study shows [significant improvements](https://nature.com/article)"  
Estonian: "Uuring näitab [märkimisväärseid täiustusi](https://nature.com/article)"  
  
Example 3:  
English: "[OpenAI's latest model](https://openai.com/gpt4) performs better"  
Estonian: "[OpenAI uusim mudel](https://openai.com/gpt4) töötab paremini"  
  
Example 4:  
English: "As explained in [this article](https://example.com/long-url-with-parameters?id=123&source=test)"  
Estonian: "Nagu [selles artiklis](https://example.com/long-url-with-parameters?id=123&source=test) selgitatakse"  
  
HYPERLINK RULES - NO EXCEPTIONS:  
1. Translate the anchor text (the part in [square brackets]) to Estonian  
2. Keep the URL (the part in parentheses) EXACTLY as it appears - DO NOT modify, shorten, or remove it  
3. The markdown syntax [text](url) must be preserved exactly  
4. NEVER output a bare URL like https://example.com - it must ALWAYS be inside [text](url) format  
5. If the source has 20 links, your translation MUST have 20 links  
6. Each URL must stay on ONE line - never split URLs across multiple lines  
  
THIS RULE OVERRIDES ALL OTHER RULES. If you must choose between perfect grammar and preserving links, PRESERVE THE LINKS.  
  
🔗🔗🔗 END OF HYPERLINK RULES 🔗🔗🔗  
  
CRITICAL RULES - MUST FOLLOW STRICTLY:  
  
Perspective and Quotations - CRITICAL:  
- ALWAYS use third person perspective throughout the entire translation  
- NEVER use first person (I, we) or second person (you)  
- ABSOLUTELY NO quotation marks for speech/citations - convert ALL quotations into indirect speech  
- Instead of: "This is amazing," said Dr. Smith → Write: Dr. Smith ütles, et see on hämmastav  
- Instead of: "We discovered..." scientists reported → Write: Teadlased teatasid, et nad avastavad...  
- For names, titles, technical terms, special expressions that have quotes in original: ALWAYS use « » (not " " or ' ')  
- Example: The "power-up" mechanism → «võimsuse lisamise» mehhanism  
- NEVER use English quotes " " or ' ' - only Estonian quotes « »  
- Do not use bold text  
- Do not begin paragraphs with dates, years or other numbers  
- EVERY statement must be in third person narrative form, no exceptions  
  
Accuracy and Completeness:  
- Translate the entire text  
- Preserve all details, tone, nuances, headings, lists, and paragraph order  
- Do not omit anything  
- Do not add meta-introductions. Output only the translation  
  
Content to EXCLUDE (do not translate):  
- Copyright notices and legal disclaimers  
- Editorial notes ("Edited by...", "Reviewed by...", "Science X editorial process")  
- "More information", "Provided by", "Citation" sections  
- Newsletter/subscription prompts  
- Social media sharing buttons text  
- Image credits and captions  
  
CRITICAL - RELATED ARTICLES DETECTION (MUST STOP IMMEDIATELY):  
- At the end of articles, you will often see lists of 5-30+ short sentences  
- These are "related articles" / "you might also like" suggestions - NOT part of the article  
- They look like article headlines: short (30-200 chars), no periods or just one period  
- Examples of what to STOP at:  
  * "Kirigami-stiilis langevarjukonstruktsioon lubab..."  
  * "TA-näitleja Tilly Norwood tekitab Londonis..."  
  * "Scientists discover new species in Amazon..."  
  * "Researchers develop breakthrough battery technology..."  
- When you see 3+ consecutive short headline-like sentences, IMMEDIATELY STOP translating  
- These lists are NEVER part of the actual article content - they are recommendations  
- Better to end the translation early than include these lists  
  
Technical and Units:  
- Use European units (kg, m, °C). Convert values when necessary  
- Translate institution, company, and technology names into Estonian and add the English name with abbreviation in parentheses  
  
Glossary:  
- healthy humans → terved inimesed  
- healthy food → tervislik toit  
- artificial intelligence → tehisaru  
- AI → TA  
  
Media Handling:  
- Remove all photos and captions  
- For YouTube videos: Vaata videot YouTube'is  
- For other videos: Vaata videot + platform name  
- Keep all video links in their exact original location  
  
The final translation must be PUBLICATION-READY with:  
- STRICT third person perspective throughout (no quotations, no direct speech)  
- Proper Estonian grammar  
- All hyperlinks embedded in Estonian text  
- Indirect speech for all citations and statements`;
 
  const systemPrompt = gemPrompt || defaultSystemPrompt;
 
  const additionalInstructions = customPrompt ? `\n\nAdditional instructions: ${customPrompt}` : '';
 
  const guidancePrompt = `  
If you need clarification about terminology, context, or specific translation choices, you should ask the user for guidance.  
  
When you have completed the translation, provide it in the following format:  
TRANSLATION_COMPLETE  
[Estonian translation of article 1 - DO NOT include the title, only the article body]  
---  
[Estonian translation of article 2 - DO NOT include the title, only the article body]  
---  
[Estonian translation of article 3 - DO NOT include the title, only the article body]  
  
CRITICAL:   
- DO NOT include the article title in your translation (title will be added separately)  
- Translate ONLY the article body/content  
- Separate each article translation with three dashes (---) on their own line`;
 
  let contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
 
  if (conversationHistory.length === 0) {
    const articlesText = articles.map((article, idx) => {
      let articleHeader = `\n\n--- ARTICLE ${idx + 1} ---\nURL: ${article.url}\n`;
      if (article.estonianTitle) {
        articleHeader += `Estonian Title (USE THIS, DO NOT TRANSLATE): ${article.estonianTitle}\n`;
        articleHeader += `English Title (for reference only): ${article.title}\n`;
      } else {
        articleHeader += `Title: ${article.title}\n`;
      }
      return `${articleHeader}\nContent: ${article.content}`;
    }).join('\n');
    contents = [
      {
        role: 'user',
        parts: [{
          text: `${systemPrompt}${additionalInstructions}${guidancePrompt}\n\nPlease translate the following ${articles.length} scientific article${articles.length > 1 ? 's' : ''} from English to Estonian:${articlesText}\n\nCRITICAL REMINDERS:  
1. 🔗🔗🔗 HYPERLINKS ARE MANDATORY - Preserve EVERY [text](url) link from the source! This is the #1 priority!  
2. DO NOT include the title in your translation - translate ONLY the article body/content  
3. If an Estonian title is provided, it's for reference only - do NOT translate the English title  
4. 🔗 HYPERLINK FORMAT: [eestikeelne tekst](https://original-url.com) - translate text, keep URL unchanged  
5. STRICT THIRD PERSON PERSPECTIVE - Convert ALL speech/citations to indirect speech. NO quotation marks for speech  
6. Example: Instead of '"This is amazing," said Dr. Smith' write 'Dr. Smith ütles, et see on hämmastav'  
7. For names/technical terms with quotes in original: ALWAYS use « » (NEVER " " or ' ')  
8. Example: The "power-up" mechanism → «võimsuse lisamise» mehhanism  
9. 🔗 COUNT THE LINKS: If source has 15 hyperlinks, your translation MUST have 15 hyperlinks in [text](url) format  
10. 🚨 STOP IMMEDIATELY when you see 3+ consecutive short headline-like sentences - these are RELATED ARTICLES, not article content  
11. Examples of where to STOP: "Kirigami-stiilis langevarjukonstruktsioon...", "Scientists discover new...", "Researchers develop..."  
12. DO NOT translate: copyright notices, editorial metadata, "More information" sections, related articles lists  
13. If you're unsure whether something is a related article, STOP EARLY rather than include it  
  
🔗 FINAL HYPERLINK CHECK BEFORE SUBMITTING:  
- Did you preserve EVERY single [text](url) link from the source?  
- Are all URLs wrapped in markdown format [text](url)?  
- Did you translate the anchor text but keep URLs unchanged?  
If you answer NO to any of these, DO NOT submit - fix the links first!  
  
Provide complete, professional Estonian translations for all articles (body text only, NO titles). If you need any clarification, ask me before proceeding.`
        }]
      }
    ];
  } else {
    contents = conversationHistory;
  }
 
    const model = ai.getGenerativeModel({ 
        model: "gemini-1.5-pro-latest",
        generationConfig: {
            temperature: 0.3,
        }
    });
    
    // Siin on tagasi sinu algne, töötav API kutse
    const result = await model.generateContent(contents[0].parts[0].text);
    const response = result.response;
    const responseText = response.text() || '';
  
  console.log(`[Gemini] Response length: ${responseText.length} characters`);

  if (responseText.includes('TRANSLATION_COMPLETE')) {
    const translation = responseText.split('TRANSLATION_COMPLETE')[1].trim();
    return { complete: true, translation };
  }

  return { complete: false, question: responseText, conversationHistory: contents };
}
  
function parseMarkdownLinks(text: string): Array<TextRun | ExternalHyperlink> {
    const elements: Array<TextRun | ExternalHyperlink> = [];
    const linkRegex = /\[([^\]]+)\]\(((?:[^()]+|\([^)]*\))*)\)/g;
    let lastIndex = 0;
    let match = linkRegex.exec(text);
    while (match !== null) {
      if (match.index > lastIndex) {
        elements.push(new TextRun({ text: text.substring(lastIndex, match.index) }));
      }
      let url = match[2].trim().replace(/[.,;!?]+$/, '');
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('www.')) {
        elements.push(new ExternalHyperlink({ children: [new TextRun({ text: match[1], style: 'Hyperlink', color: '0563C1', underline: { type: 'single' } })], link: url }));
      } else {
        elements.push(new TextRun({ text: `[${match[1]}](${url})` }));
      }
      lastIndex = match.index + match[0].length;
      match = linkRegex.exec(text);
    }
    if (lastIndex < text.length) {
      elements.push(new TextRun({ text: text.substring(lastIndex) }));
    }
    return elements;
}
  
function generateDocx(articles: Array<{ title: string; url: string; estonianTitle?: string }>, translation: string) {
    const children: Paragraph[] = [];
    const translationSections = translation.split(/---+/).map(s => s.trim()).filter(s => s.length > 0);
    articles.forEach((article, idx) => {
      const displayTitle = article.estonianTitle || article.title;
      children.push(new Paragraph({ children: [new TextRun({ text: displayTitle, bold: true, size: 24 })], spacing: { after: 200 } }));
      children.push(new Paragraph({ children: [new ExternalHyperlink({ children: [new TextRun({ text: article.url, style: 'Hyperlink', color: '0563C1', underline: { type: 'single' } })], link: article.url })], spacing: { after: 200 } }));
      children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
      const articleTranslation = translationSections[idx] || '';
      for (const para of articleTranslation.split('\n\n')) {
        if (para.trim()) {
          const paraElements = parseMarkdownLinks(para.trim());
          children.push(new Paragraph({ children: paraElements, spacing: { after: 200 } }));
          children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        }
      }
      if (idx < articles.length - 1) {
        children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        children.push(new Paragraph({ text: '---', spacing: { after: 200 } }));
        children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
      }
    });
    const doc = new Document({ sections: [{ properties: {}, children }] });
    return Packer.toBuffer(doc);
}
  
export async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const { articleEntries, apiKey, gemPrompt, customPrompt, translationId, userInput } = body;
      if (!apiKey) {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 });
      }
      if (translationId && userInput) {
        const session = activeSessions.get(translationId);
        if (!session) {
          return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }
        session.conversationHistory.push({ role: 'model', parts: [{ text: session.conversationHistory[session.conversationHistory.length - 1]?.parts[0]?.text || '' }] });
        session.conversationHistory.push({ role: 'user', parts: [{ text: userInput }] });
        const result = await translateWithGemini(session.articles, session.apiKey, session.gemPrompt, session.customPrompt, session.conversationHistory);
        if (result.complete && result.translation) {
          const docxBuffer = await generateDocx(session.articles, result.translation);
          activeSessions.delete(translationId);
          return NextResponse.json({ complete: true, docx: Buffer.from(docxBuffer).toString('base64') });
        }
        session.conversationHistory = result.conversationHistory || session.conversationHistory;
        return NextResponse.json({ needsInput: true, question: result.question, translationId, progress: 60 });
      }
      if (!articleEntries || articleEntries.length === 0) {
        return NextResponse.json({ error: 'At least one article is required' }, { status: 400 });
      }
      const articles = [];
      for (const entry of articleEntries) {
        try {
          const article = await scrapeArticle(entry.url, entry.estonianTitle);
          articles.push(article);
        } catch (error) {
          console.error(`Failed to scrape ${entry.url}:`, error);
          return NextResponse.json({ error: `Failed to scrape article from ${entry.url}: ${error instanceof Error ? error.message : 'Unknown error'}` }, { status: 500 });
        }
      }
      const result = await translateWithGemini(articles, apiKey, gemPrompt, customPrompt);
      if (result.complete && result.translation) {
        const docxBuffer = await generateDocx(articles, result.translation);
        return NextResponse.json({ complete: true, docx: Buffer.from(docxBuffer).toString('base64') });
      }
      const sessionId = `trans_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      activeSessions.set(sessionId, { articles, conversationHistory: result.conversationHistory || [], apiKey, gemPrompt, customPrompt });
      return NextResponse.json({ needsInput: true, question: result.question, translationId: sessionId });
    } catch (error) {
      console.error('Translation error:', error);
      return NextResponse.json({ error: error instanceof Error ? error.message : 'An unexpected error occurred' }, { status: 500 });
    }
}
