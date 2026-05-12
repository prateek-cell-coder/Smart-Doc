using { smart.doc.ai as db } from '../db/schema';

@path: '/smartdoc'
service SmartDocService {

    // ── Upload and analyze document ──
    action uploadDocument(
        fileName    : String,
        fileType    : String,
        fileContent : LargeString    // Base64 encoded file content
    ) returns {
        success    : Boolean;
        documentId : String;
        message    : String;
    };

    // ── Translate document ──
    action translateDocument(
        documentId  : String,
        targetLang  : String         // Default: English
    ) returns {
        success          : Boolean;
        translatedContent: String;
        detectedLanguage : String;
        message          : String;
    };

    // ── Ask question about document ──
    action askQuestion(
        documentId : String,
        question   : String
    ) returns {
        success  : Boolean;
        answer   : String;
        message  : String;
    };

    // ── Get document summary ──
    action summarizeDocument(
        documentId : String
    ) returns {
        success : Boolean;
        summary : String;
        message : String;
    };

    // ── Read entities for UI ──
    entity Documents        as projection on db.Document;
    entity ExtractedFields  as projection on db.ExtractedField;
    entity QAConversations  as projection on db.QAConversation;

}