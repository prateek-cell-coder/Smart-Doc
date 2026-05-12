const cds = require('@sap/cds');
require('dotenv').config();

// ── Extract text from file ──
async function extractText(buffer, fileType) {
    try {
        if (fileType === 'PDF') {
            const { PDFParse } = require('pdf-parse');
            const parser = new PDFParse({
                data      : buffer,
                verbosity : 0
            });
            const result = await parser.getText({});
            console.log('PDF text extracted, length:', result.text.length);
            console.log('Preview:', result.text.substring(0, 300));
            return result.text;
        }
        return buffer.toString('utf-8');
    } catch (err) {
        console.error('PDF parse error:', err.message);
        return buffer.toString('utf-8');
    }
}

// ── Mistral API call helper ──
async function callMistral(prompt, maxTokens = 4000) {

    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

    if (!MISTRAL_API_KEY) {
        throw new Error('Mistral API key not configured. Check your .env file.');
    }

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method  : 'POST',
        headers : {
            'Content-Type'  : 'application/json',
            'Authorization' : `Bearer ${MISTRAL_API_KEY}`
        },
        body : JSON.stringify({
            model      : 'mistral-small-latest',
            max_tokens : maxTokens,
            messages   : [
                { role: 'user', content: prompt }
            ]
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Mistral API error: ${JSON.stringify(data)}`);
    }

    return data.choices[0].message.content;
}

module.exports = cds.service.impl(async function () {

    // ── Upload and Analyze Document ──
    this.on('uploadDocument', async (req) => {
        const { fileName, fileType, fileContent } = req.data;

        try {
            const { Document, ExtractedField } = cds.entities('smart.doc.ai');

            // Step 1 — Decode base64 to buffer then extract text properly
            const buffer         = Buffer.from(fileContent, 'base64');
            const decodedContent = await extractText(buffer, fileType);

            console.log('Decoded content preview:', decodedContent.substring(0, 200));

            if (!decodedContent || decodedContent.trim().length < 10) {
                return {
                    success    : false,
                    documentId : '',
                    message    : 'Could not extract text from document. Please try a different file.'
                };
            }

            // Step 2 — Create document record
            const docId = cds.utils.uuid();
            await INSERT.into(Document).entries({
                ID              : docId,
                fileName        : fileName,
                fileType        : fileType,
                fileSize        : fileContent.length,
                status          : 'ANALYZING',
                originalContent : decodedContent,
                uploadedBy      : req.user?.id || 'anonymous'
            });

            // Step 3 — Call Mistral to analyze
            const analysisPrompt = `You are an expert document analyzer.
Analyze the given document and return ONLY a valid JSON object with this exact structure:
{
    "detectedLanguage": "language name in English",
    "summary": "5 bullet point summary of the document",
    "extractedFields": [
        {"fieldName": "field name", "fieldValue": "value", "fieldType": "DATE|AMOUNT|PERSON|ORGANIZATION|OTHER"}
    ],
    "keyTopics": ["topic1", "topic2", "topic3"]
}
Extract all important dates, monetary amounts, person names, and organization names.
Return ONLY the JSON, no other text, no markdown, no backticks.

Document to analyze:
${decodedContent.substring(0, 50000)}`;

            const analysisResult = await callMistral(analysisPrompt);

            // Step 4 — Parse Mistral response
            const cleanJson = analysisResult.replace(/```json|```/g, '').trim();
            const analysis  = JSON.parse(cleanJson);

            // Step 5 — Update document with analysis
            await UPDATE(Document)
                .set({
                    status           : 'DONE',
                    originalLanguage : analysis.detectedLanguage || 'Unknown',
                    summary          : analysis.summary          || '',
                    extractedFields  : JSON.stringify(analysis.extractedFields || [])
                })
                .where({ ID: docId });

            // Step 6 — Save extracted fields
            if (analysis.extractedFields && analysis.extractedFields.length > 0) {
                const fieldEntries = analysis.extractedFields.map(f => ({
                    ID          : cds.utils.uuid(),
                    document_ID : docId,
                    fieldName   : f.fieldName  || '',
                    fieldValue  : f.fieldValue || '',
                    fieldType   : f.fieldType  || 'OTHER'
                }));
                await INSERT.into(ExtractedField).entries(fieldEntries);
            }

            return {
                success    : true,
                documentId : docId,
                message    : `Document analyzed successfully! Detected language: ${analysis.detectedLanguage}`
            };

        } catch (error) {
            console.error('Upload/analyze failed:', error.message);
            return {
                success    : false,
                documentId : '',
                message    : `Failed to analyze document: ${error.message}`
            };
        }
    });

    // ── Translate Document ──
    this.on('translateDocument', async (req) => {
        const { documentId, targetLang } = req.data;
        const target = targetLang || 'English';

        try {
            const { Document } = cds.entities('smart.doc.ai');

            const doc = await SELECT.one.from(Document).where({ ID: documentId });
            if (!doc) return { success: false, translatedContent: '', detectedLanguage: '', message: 'Document not found.' };

            if (!doc.originalContent) {
                return { success: false, translatedContent: '', detectedLanguage: '', message: 'No content to translate.' };
            }

            const translatePrompt = `You are an expert translator.
Translate the following text to ${target}.
Preserve the original formatting and structure as much as possible.
Return ONLY the translated text, nothing else.

Text to translate:
${doc.originalContent.substring(0, 50000)}`;

            const translatedContent = await callMistral(translatePrompt, 8000);

            await UPDATE(Document)
                .set({ translatedContent: translatedContent })
                .where({ ID: documentId });

            return {
                success           : true,
                translatedContent : translatedContent,
                detectedLanguage  : doc.originalLanguage || 'Unknown',
                message           : `Successfully translated from ${doc.originalLanguage} to ${target}`
            };

        } catch (error) {
            console.error('Translation failed:', error.message);
            return {
                success           : false,
                translatedContent : '',
                detectedLanguage  : '',
                message           : `Translation failed: ${error.message}`
            };
        }
    });

    // ── Ask Question About Document ──
    this.on('askQuestion', async (req) => {
        const { documentId, question } = req.data;

        try {
            const { Document, QAConversation } = cds.entities('smart.doc.ai');

            const doc = await SELECT.one.from(Document).where({ ID: documentId });
            if (!doc) return { success: false, answer: '', message: 'Document not found.' };

            const content = doc.translatedContent || doc.originalContent || '';

            const qaPrompt = `You are an expert document assistant.
Answer the following question about the document accurately and concisely.
If the answer is not in the document, say so clearly.
Base your answer ONLY on the document content provided.

Document content:
${content.substring(0, 50000)}

Question: ${question}`;

            const answer = await callMistral(qaPrompt, 2000);

            await INSERT.into(QAConversation).entries({
                ID          : cds.utils.uuid(),
                document_ID : documentId,
                question    : question,
                answer      : answer,
                askedAt     : new Date().toISOString()
            });

            return {
                success : true,
                answer  : answer,
                message : 'Question answered successfully'
            };

        } catch (error) {
            console.error('Q&A failed:', error.message);
            return {
                success : false,
                answer  : '',
                message : `Failed to answer question: ${error.message}`
            };
        }
    });

    // ── Summarize Document ──
    this.on('summarizeDocument', async (req) => {
        const { documentId } = req.data;

        try {
            const { Document } = cds.entities('smart.doc.ai');

            const doc = await SELECT.one.from(Document).where({ ID: documentId });
            if (!doc) return { success: false, summary: '', message: 'Document not found.' };

            if (doc.summary) {
                return { success: true, summary: doc.summary, message: 'Summary retrieved.' };
            }

            const content = doc.originalContent || '';

            const summaryPrompt = `You are an expert document summarizer.
Create a clear, concise summary of the document in bullet points.
Include: main topics, key decisions, important dates, and action items if any.
Format the summary with bullet points using the bullet character.

Document to summarize:
${content.substring(0, 50000)}`;

            const summary = await callMistral(summaryPrompt, 2000);

            await UPDATE(Document)
                .set({ summary: summary })
                .where({ ID: documentId });

            return {
                success : true,
                summary : summary,
                message : 'Document summarized successfully'
            };

        } catch (error) {
            console.error('Summarization failed:', error.message);
            return {
                success : false,
                summary : '',
                message : `Summarization failed: ${error.message}`
            };
        }
    });

});